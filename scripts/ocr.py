#!/usr/bin/env python3
"""
本地发票 OCR 脚本
依赖: pip install paddleocr paddlepaddle pymupdf opencv-python-headless

三层识别策略（速度递减，按需降级）：
  1. QR 码  — 毫秒级，提取：发票号码、含税金额、开票日期
  2. 文本提取 — 毫秒级，提取：销售方、税额、分类等（数字 PDF 专用）
  3. OCR     — 秒级，兜底扫描件 / 图片 PDF

用法:
  单次: python ocr.py <pdf_path>
  常驻: python ocr.py --server   (stdin/stdout JSON 通信)
"""

import sys
import json
import re
import os
import warnings
from concurrent.futures import ThreadPoolExecutor

os.environ['PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK'] = 'True'
warnings.filterwarnings('ignore')

_MAX_MONEY_VALUE = 1_000_000_000.0


def parse_money(raw):
    """
    解析金额字段，过滤税号这类长数字误识别。
    返回 float 或 None。
    """
    if raw is None:
        return None

    s = str(raw).strip().replace(',', '').replace('，', '')
    if not re.fullmatch(r'\d+(?:\.\d{1,2})?', s):
        return None

    int_part = s.split('.', 1)[0]
    # 纯数字过长通常是税号/编码，不是金额
    if '.' not in s and len(int_part) >= 15:
        return None
    if len(int_part) > 9:
        return None

    value = float(s)
    if value < 0 or value > _MAX_MONEY_VALUE:
        return None

    return round(value, 2)


# ─────────────────────────────────────────────────────────────────────────────
# 第一层：QR 码解析
# ─────────────────────────────────────────────────────────────────────────────

def extract_qr_from_pdf(pdf_path, max_pages=1):
    """用 OpenCV 从 PDF 首页提取所有 QR 码文本。失败时静默返回空列表。"""
    try:
        import fitz
        import numpy as np
        import cv2

        doc = fitz.open(pdf_path)
        qr_texts = []
        for i, page in enumerate(doc):
            if i >= max_pages:
                break
            pix = page.get_pixmap(matrix=fitz.Matrix(3.0, 3.0))
            img = np.frombuffer(pix.samples, dtype=np.uint8).reshape(
                pix.height, pix.width, pix.n
            )
            if pix.n == 4:
                img = img[:, :, :3]
            gray = cv2.cvtColor(img, cv2.COLOR_RGB2GRAY)
            data, _, _ = cv2.QRCodeDetector().detectAndDecode(gray)
            if data:
                qr_texts.append(data.strip())
        doc.close()
        return qr_texts
    except Exception:
        return []


def parse_invoice_qr(qr_text):
    """
    解析中国增值税电子发票 QR 码。

    已知格式（逗号分隔）：
      01, 省份码, 发票代码, 发票号码, 含税金额, 日期YYYYMMDD, 税前金额, 校验码

    返回提取到的字段字典（仅包含有值的字段）。
    """
    result = {}
    parts = [p.strip() for p in qr_text.split(',')]

    if len(parts) >= 6 and parts[0] in ('01', '04', '10', '11'):
        # parts[3]: 发票号码
        if len(parts) > 3 and re.match(r'^\d{8,20}$', parts[3]):
            result['invoice_no'] = parts[3]

        # parts[4]: 含税金额
        if len(parts) > 4 and re.match(r'^\d+\.?\d*$', parts[4]):
            money = parse_money(parts[4])
            if money is not None:
                result['total'] = money

        # parts[5]: 日期 YYYYMMDD
        if len(parts) > 5 and re.match(r'^\d{8}$', parts[5]):
            d = parts[5]
            result['date'] = f'{d[:4]}-{d[4:6]}-{d[6:8]}'

        # parts[6]: 税前金额（可为空）
        if len(parts) > 6 and re.match(r'^\d+\.?\d*$', parts[6]):
            amt = parse_money(parts[6])
            if amt is not None and amt > 0:
                result['amount'] = amt

        if result.get('total') is not None and result.get('amount') is not None:
            tax = round(result['total'] - result['amount'], 2)
            if tax >= 0:
                result['tax'] = tax

    return result


# ─────────────────────────────────────────────────────────────────────────────
# 第二层：PDF 文本提取
# ─────────────────────────────────────────────────────────────────────────────

_TEXT_THRESHOLD = 50  # 低于此字符数视为扫描件

def extract_text_from_pdf(pdf_path, max_pages=2):
    """
    直接提取 PDF 嵌入文本。
    返回 (lines: list[str], is_text_based: bool)
    """
    import fitz
    doc = fitz.open(pdf_path)
    all_text = ''
    for i, page in enumerate(doc):
        if i >= max_pages:
            break
        all_text += page.get_text()
    doc.close()

    stripped = all_text.strip()
    if len(stripped) < _TEXT_THRESHOLD:
        return [], False

    lines = [l.strip() for l in stripped.splitlines() if l.strip()]
    return lines, True


# ─────────────────────────────────────────────────────────────────────────────
# 第三层：OCR（扫描件兜底）
# ─────────────────────────────────────────────────────────────────────────────

_ocr = None

def get_ocr():
    global _ocr
    if _ocr is None:
        import logging
        logging.disable(logging.CRITICAL)
        from paddleocr import PaddleOCR
        _ocr = PaddleOCR(
            lang='ch',
            use_doc_orientation_classify=False,
            use_doc_unwarping=False,
            use_textline_orientation=False,
        )
    return _ocr


def pdf_to_images(pdf_path, max_pages=2):
    import fitz, numpy as np
    doc = fitz.open(pdf_path)
    images = []
    for i, page in enumerate(doc):
        if i >= max_pages:
            break
        pix = page.get_pixmap(matrix=fitz.Matrix(2.0, 2.0))
        img = np.frombuffer(pix.samples, dtype=np.uint8).reshape(
            pix.height, pix.width, pix.n
        )
        if pix.n == 4:
            img = img[:, :, :3]
        images.append(img)
    doc.close()
    return images


def run_ocr(images):
    ocr = get_ocr()
    lines = []
    for img in images:
        for res in ocr.predict(img):
            for text in res.get('rec_texts', []):
                t = text.strip()
                if t:
                    lines.append(t)
    return lines


# ─────────────────────────────────────────────────────────────────────────────
# 字段提取（从文本行中解析结构化字段）
# ─────────────────────────────────────────────────────────────────────────────

def extract_fields(lines):
    text = '\n'.join(lines)

    def _extract_line_money_values(line):
        values = []
        for raw in re.findall(r'(?<!\d)(\d[\d,，]*\.\d{1,2})(?!\d)', line):
            money = parse_money(raw)
            if money is not None:
                values.append(money)
        return values

    def _parse_date_candidate(line):
        line = line.strip()
        for pat in [
            r'(\d{4})[年\-/](\d{1,2})[月\-/](\d{1,2})',
            r'(\d{4})(\d{2})(\d{2})',
        ]:
            m = re.search(pat, line)
            if m:
                return f'{m.group(1)}-{m.group(2).zfill(2)}-{m.group(3).zfill(2)}'
        return None

    # 发票号码
    invoice_no = None
    for pat in [
        r'发票号码[：:]\s*(\d{8,20})',
        r'No[.．]\s*(\d{8,20})',
        r'票号[：:]\s*(\d{8,20})',
    ]:
        m = re.search(pat, text)
        if m:
            invoice_no = m.group(1)
            break

    # 标签和值分离：发票号码在后续独立一行
    if invoice_no is None:
        for idx, line in enumerate(lines):
            if '发票号码' not in line and '票号' not in line:
                continue
            for j in range(idx + 1, min(idx + 4, len(lines))):
                candidate = lines[j].strip()
                if re.fullmatch(r'\d{8,20}', candidate):
                    invoice_no = candidate
                    break
            if invoice_no is not None:
                break

    # 兜底：独立长数字行，且附近出现过"发票号码"
    if invoice_no is None:
        label_positions = [i for i, line in enumerate(lines) if '发票号码' in line or '票号' in line]
        for idx, line in enumerate(lines):
            candidate = line.strip()
            if not re.fullmatch(r'\d{8,20}', candidate):
                continue
            if any(abs(idx - pos) <= 4 for pos in label_positions):
                invoice_no = candidate
                break

    # 开票日期
    date = None
    for pat in [
        r'开票日期[：:]\s*(\d{4})[年\-/](\d{1,2})[月\-/](\d{1,2})',
        r'日\s*期[：:]\s*(\d{4})[年\-/](\d{1,2})[月\-/](\d{1,2})',
        r'(\d{4})[年\-/](\d{1,2})[月\-/](\d{1,2})[日号]',
    ]:
        m = re.search(pat, text)
        if m:
            date = f'{m.group(1)}-{m.group(2).zfill(2)}-{m.group(3).zfill(2)}'
            break

    # 票号/日期分离布局：独立数字行旁边有日期，且靠近页头标签区
    if invoice_no is None:
        label_positions = [i for i, line in enumerate(lines) if '发票号码' in line or '开票日期' in line or '票号' in line]
        for idx, line in enumerate(lines):
            candidate = line.strip()
            if not re.fullmatch(r'\d{8,20}', candidate):
                continue

            nearby_dates = []
            for j in range(max(0, idx - 2), min(len(lines), idx + 3)):
                if j == idx:
                    continue
                parsed = _parse_date_candidate(lines[j])
                if parsed:
                    nearby_dates.append(parsed)

            if nearby_dates and any(abs(idx - pos) <= 40 for pos in label_positions):
                invoice_no = candidate
                if date is None:
                    date = nearby_dates[0]
                break

    # ── 销售方名称 & 税号 ────────────────────────────────────────────────────
    # 发票布局分三类：
    #   A  名称：公司名  同行（盒马、滴滴等）
    #   B  标签/值分离，值区：买方名→买方税号→卖方名→卖方税号（或名1→名2→税号1→税号2）
    #   C  特殊票据（高铁电子客票，无销售方字段）
    vendor = None
    vendor_tax_id = None

    _TAX_ID_RE = re.compile(r'^[0-9A-Z]{18}$')

    def _clean_vendor(v):
        """清理并校验 vendor 候选值；无效返回 None。"""
        v = v.strip().rstrip('，,。.')
        if not v or re.match(r'^[\s：:]*$', v):
            return None
        if '：' in v or ':' in v:          # 另一个标签，不是名称值
            return None
        # 标签文本误识别（不是公司名称）
        _LABEL_TOKENS = (
            '统一社会信用代码', '纳税人识别号', '识别号', '税号',
            '名称', '地址', '电话', '开户行', '账号'
        )
        if any(tok in v for tok in _LABEL_TOKENS):
            return None
        if not re.search(r'[\u4e00-\u9fff]', v):  # 必须含汉字
            return None
        return v

    # ── 策略1：内联名称对（Layout A / 滴滴等）─────────────────────────────
    # 找所有 "名称：公司名" 内联行；同一发票中出现顺序为 买方在前、卖方在后
    _inline_names = [
        _clean_vendor(m.group(1))
        for m in re.finditer(r'名\s*称[：:]\s*([^\n：:]{2,40})', text)
    ]
    _inline_names = [v for v in _inline_names if v]
    if len(_inline_names) >= 2:
        vendor = _inline_names[1]          # 第2个=销售方

    # 含标签的内联税号（"统一社会信用代码/纳税人识别号:XXXXXXXXXX"）
    _inline_tax_ids = re.findall(
        r'(?:统一社会信用代码|纳税人识别号)[/／\w]*[：:]\s*([0-9A-Z]{15,20})',
        text
    )
    if len(_inline_tax_ids) >= 2:
        vendor_tax_id = _inline_tax_ids[1]  # 第2个=销售方税号

    # ── 高铁/火车票：无销售方企业字段，直接设为"中国铁路"──────────────────
    if not vendor and ('铁路电子客票' in text or '电子客票号' in text):
        vendor = '中国铁路'

    # ── 策略2A：后缀匹配（Layout B，找第2家公司名=销售方）──────────────────
    if not vendor:
        _SUFFIXES = (
            '公司|店|厂|局|院|馆|酒店|餐厅|饭店|超市|银行|科技|集团|服务|餐饮'
            '|铺|社|所|中心|部|站|处|坊|园|场|网络|贸易|商贸|工作室|诊所|药店'
        )
        company_pat = re.compile(rf'^[\s\S]{{2,40}}(?:{_SUFFIXES})[\S]{{0,8}}$')
        _GOVT_PREFIXES = ('国家税务', '全国统一', '省税务', '市税务')
        companies = [
            l for l in lines
            if company_pat.match(l)
            and not _TAX_ID_RE.match(l)
            and not re.search(r'[%％¥￥\d]{3,}', l)
            and not any(l.startswith(p) for p in _GOVT_PREFIXES)
        ]
        if len(companies) >= 2:
            vendor = companies[1]           # 第1个=买方，第2个=销售方

    # ── 策略2B：以独立行税号为锚点（Layout B type 2）──────────────────────
    if not vendor:
        tax_positions = [i for i, l in enumerate(lines) if _TAX_ID_RE.match(l)]
        if len(tax_positions) >= 2:
            p1, p2 = tax_positions[0], tax_positions[1]
            between = [lines[i] for i in range(p1 + 1, p2)
                       if lines[i].strip() and not _TAX_ID_RE.match(lines[i])]
            if between:
                vendor = between[-1]
            else:
                for j in range(p2 - 1, max(p2 - 8, -1), -1):
                    c = lines[j].strip()
                    if c and not _TAX_ID_RE.match(c) and '：' not in c and ':' not in c:
                        vendor = c
                        break

    # ── 税号补充：从独立行提取（内联未找到时）─────────────────────────────
    if not vendor_tax_id:
        standalone = [l for l in lines if _TAX_ID_RE.match(l)]
        if len(standalone) >= 2:
            vendor_tax_id = standalone[1]


    # 金额
    total = amount = tax = None
    for pat in [
        r'价税合计[（(]大写[）)][^¥￥\d]*[¥￥]\s*([\d,，.]+)',
        # 分离布局：（小写）单独一行，金额在后几行（支持全角半角括号）
        r'[（(]小写[）)][^\d¥￥]{0,40}([\d,，.]{3,})',
        r'合\s*计[：:]\s*[¥￥]\s*([\d,，.]+)',
        r'实付金额[：:]\s*[¥￥]?\s*([\d,，.]+)',
        # 高铁/出租车票价
        r'票价[：:]\s*[¥￥￥]\s*([\d,，.]+)',
    ]:
        m = re.search(pat, text)
        if m:
            money = parse_money(m.group(1))
            if money is not None:
                total = money
                break

    for pat in [r'不含税金额[：:]\s*[¥￥]?\s*([\d,，.]+)',
                r'税前金额[：:]\s*[¥￥]?\s*([\d,，.]+)']:
        m = re.search(pat, text)
        if m:
            money = parse_money(m.group(1))
            if money is not None:
                amount = money
                break

    for pat in [r'税\s*额[：:]\s*[¥￥]?\s*([\d,，.]+)',
                r'增值税额[：:]\s*[¥￥]?\s*([\d,，.]+)']:
        m = re.search(pat, text)
        if m:
            money = parse_money(m.group(1))
            if money is not None:
                tax = money
                break

    # 合计税额（汇总行）
    if tax is None:
        m = re.search(r'合\s*计.*?[¥￥]\s*[\d.]+\s*[¥￥]\s*([\d.]+)', text)
        if m:
            tax = parse_money(m.group(1))

    # 常见电子发票汇总行：合计 123.45 7.41
    if amount is None or tax is None:
        for line in lines:
            normalized = line.replace('　', ' ').strip()
            if '价税合计' in normalized:
                continue
            if '合计' not in normalized:
                continue
            nums = _extract_line_money_values(normalized)
            if len(nums) >= 2:
                cand_amount, cand_tax = nums[-2], nums[-1]
                if cand_amount >= cand_tax:
                    if amount is None:
                        amount = cand_amount
                    if tax is None:
                        tax = cand_tax
                    break

    # 邻近标签布局：金额 / 税额 分行或同行出现
    if amount is None or tax is None:
        for idx, line in enumerate(lines):
            window = ' '.join(lines[idx: idx + 3])

            if amount is None and ('金额' in line or '金额' in window):
                nums = _extract_line_money_values(window)
                if nums:
                    amount = nums[0]

            if tax is None and ('税额' in line or '增值税额' in line or '税额' in window):
                nums = _extract_line_money_values(window)
                if nums:
                    tax = nums[-1]

    # 兜底：从带货币符号的值中推断 amount/tax/total（适配分行表格票）
    currency_vals = []
    plain_money_vals = []
    for line in lines:
        plain_money_vals.extend(_extract_line_money_values(line))
        for raw in re.findall(r'[¥￥]\s*([\d,，]+(?:\.\d{1,2})?)', line):
            money = parse_money(raw)
            if money is not None:
                currency_vals.append(money)

    money_candidates = currency_vals[:] if currency_vals else []
    if plain_money_vals:
        seen = set(money_candidates)
        for value in plain_money_vals:
            if value not in seen:
                money_candidates.append(value)
                seen.add(value)

    if money_candidates:
        inferred_amount = inferred_tax = inferred_total = None
        if len(money_candidates) >= 3:
            for i in range(len(money_candidates) - 2):
                a, t, tot = money_candidates[i], money_candidates[i + 1], money_candidates[i + 2]
                if t <= tot and a <= tot and abs((a + t) - tot) <= 0.05:
                    inferred_amount, inferred_tax, inferred_total = a, t, tot
                    break

        # 已有 total 时，再尝试从所有货币值里找一对 amount + tax = total
        if total is not None and (amount is None or tax is None):
            pair_candidates = []
            for i in range(len(money_candidates)):
                for j in range(i + 1, len(money_candidates)):
                    x, y = money_candidates[i], money_candidates[j]
                    if x > total or y > total:
                        continue
                    diff = abs((x + y) - total)
                    if diff <= 0.05:
                        cand_amount, cand_tax = max(x, y), min(x, y)
                        pair_candidates.append((diff, cand_amount, cand_tax))

            if pair_candidates:
                pair_candidates.sort(key=lambda item: (item[0], -item[1], item[2]))
                _, pair_amount, pair_tax = pair_candidates[0]
                if amount is None:
                    amount = pair_amount
                if tax is None:
                    tax = pair_tax

        if inferred_total is None:
            inferred_total = max(money_candidates)

        if amount is None and inferred_amount is not None:
            amount = inferred_amount
        if tax is None and inferred_tax is not None:
            tax = inferred_tax
        if total is None and inferred_total is not None:
            total = inferred_total

    if total and tax and not amount:
        amount = round(total - tax, 2)
    if total is not None and amount is not None and tax is None:
        inferred_tax = round(total - amount, 2)
        if inferred_tax >= 0:
            tax = inferred_tax

    if total is not None and tax is not None and tax > total:
        tax = None
    if total is not None and amount is not None and amount > total:
        amount = None

    # 发票类型
    invoice_type = '其他'
    for t, kws in [
        ('增值税专用发票', ['增值税专用发票', '专用发票']),
        ('增值税普通发票', ['增值税普通发票', '普通发票', '电子普通发票', '电子发票']),
        ('行程单',       ['行程单', '机票', '火车票', '高铁', '航空']),
        ('酒店发票',     ['住宿', '酒店', '宾馆', '客房', '房费']),
        ('出租车票',     ['出租车', '打车', '滴滴', '快车', '网约车', '的士']),
    ]:
        if any(kw in text for kw in kws):
            invoice_type = t
            break

    # 费用分类（四类，优先级从高到低）
    category = '餐饮外卖'
    for cat, kws in [
        ('城市间交通', ['机票', '火车票', '高铁', '铁路', '行程单', '电子客票', '铁路电子客票']),
        ('打车',     ['出租车', '滴滴', '打车', '地铁', '公交', '快车', '网约车', '旅客运输']),
        ('住宿',     ['住宿', '酒店', '宾馆', '客房', '民宿', '房费']),
    ]:
        if any(kw in text for kw in kws):
            category = cat
            break

    return {
        'invoice_no': invoice_no,
        'date': date,
        'vendor': vendor,
        'vendor_tax_id': vendor_tax_id,
        'amount': amount,
        'tax': tax,
        'total': total,
        'category': category,
        'invoice_type': invoice_type,
    }


# ─────────────────────────────────────────────────────────────────────────────
# 主处理逻辑：三层合并
# ─────────────────────────────────────────────────────────────────────────────

def process(pdf_path):
    sources = []

    # ── 第一层：QR 码 ──────────────────────────────────────────────────────
    qr_fields = {}
    for qr_text in extract_qr_from_pdf(pdf_path):
        parsed = parse_invoice_qr(qr_text)
        qr_fields.update({k: v for k, v in parsed.items() if v is not None})
    if qr_fields:
        sources.append('qr')

    # ── 第二层：PDF 文本提取 ────────────────────────────────────────────────
    lines, is_text_based = extract_text_from_pdf(pdf_path)

    if is_text_based:
        text_fields = extract_fields(lines)
        sources.append('text')
    else:
        # ── 第三层：OCR（扫描件兜底）─────────────────────────────────────
        lines = run_ocr(pdf_to_images(pdf_path))
        text_fields = extract_fields(lines)
        sources.append('ocr')

    # ── 合并：QR 字段优先（最可靠），其余用文本/OCR 补充 ──────────────────
    # QR 提供：invoice_no、total、date、amount、tax
    # 文本/OCR 提供：vendor、tax、category、invoice_type（及 QR 没有的字段）
    result = text_fields.copy()
    for key in ('invoice_no', 'total', 'date', 'amount', 'tax'):
        if qr_fields.get(key) is not None:
            result[key] = qr_fields[key]

    # 如果 QR 有 total 但文本没解析出 tax，尝试从合计行补算
    if result.get('total') and result.get('tax') and not result.get('amount'):
        result['amount'] = round(result['total'] - result['tax'], 2)

    result['_source'] = '+'.join(sources)
    result['_ocr_lines'] = lines
    return result


# ─────────────────────────────────────────────────────────────────────────────
# 入口
# ─────────────────────────────────────────────────────────────────────────────

# ─────────────────────────────────────────────────────────────────────────────
# 目录扫描：三阶段判断
#   1) 先扫码（QR）
#   2) 再文本提取补全判断
#   3) 文本为空/低置信时做轻量 OCR（仅第一页）
# ─────────────────────────────────────────────────────────────────────────────

_SCAN_STRONG_KEYWORDS = [
    '发票代码', '发票号码', '开票日期', '价税合计', '纳税人识别号',
    '统一社会信用代码', '销售方', '购买方', '增值税',
]

_SCAN_WEAK_KEYWORDS = [
    '电子发票', '普通发票', '专用发票', '税务总局', '行程单',
    '电子客票', '铁路', '票价', '酒店', '出租车',
]

_TRIP_ITINERARY_KEYWORDS = [
    '行程单', '滴滴出行', '网约车', '快车', '专车', '订单号',
    '上车时间', '下车时间', '行程起点', '行程终点', '实付金额',
]

_TRIP_RIDE_KEYWORDS = ['滴滴', '网约车', '快车', '专车', '出租车', '打车', '的士']

_SCAN_SCORE_CONFIDENT = 4
_SCAN_SCORE_LOW_CONF = 3
_SCAN_MODE_SET = {'fast', 'balanced', 'accurate'}

def _scan_text_score(text):
    normalized = text.replace(' ', '').replace('\t', '')
    strong_hits = [kw for kw in _SCAN_STRONG_KEYWORDS if kw in normalized]
    weak_hits = [kw for kw in _SCAN_WEAK_KEYWORDS if kw in normalized]
    score = len(strong_hits) * 2 + len(weak_hits)
    if '¥' in text or '￥' in text:
        score += 1
    return score, strong_hits, weak_hits


def _looks_like_trip_itinerary(text):
    normalized = text.replace(' ', '').replace('\t', '')
    strong_hits = sum(1 for kw in _SCAN_STRONG_KEYWORDS if kw in normalized)
    itinerary_hits = sum(1 for kw in _TRIP_ITINERARY_KEYWORDS if kw in normalized)
    ride_hits = sum(1 for kw in _TRIP_RIDE_KEYWORDS if kw in normalized)

    if strong_hits > 0:
        return False
    if '发票号码' in normalized or '发票代码' in normalized or '纳税人识别号' in normalized:
        return False

    return itinerary_hits >= 2 and ride_hits >= 1


def _scan_with_qr(pdf_path, mode='balanced'):
    qr_fields = {}
    for qr_text in extract_qr_from_pdf(pdf_path, max_pages=1):
        parsed = parse_invoice_qr(qr_text)
        qr_fields.update({k: v for k, v in parsed.items() if v is not None})

    # 常见可靠组合：有发票号 + (金额或日期)
    qr_confident = bool(
        qr_fields.get('invoice_no')
        and (qr_fields.get('total') is not None or qr_fields.get('date') is not None)
    )
    return qr_fields, qr_confident


def _scan_with_text(pdf_path, mode='balanced'):
    max_pages = 1 if mode == 'fast' else 2
    lines, is_text_based = extract_text_from_pdf(pdf_path, max_pages=max_pages)
    text = '\n'.join(lines) if lines else ''
    score, strong_hits, _ = _scan_text_score(text)
    confident = len(strong_hits) >= 2 or score >= _SCAN_SCORE_CONFIDENT
    low_confidence = (not is_text_based) or score < _SCAN_SCORE_LOW_CONF
    return {
        'is_text_based': is_text_based,
        'text': text,
        'score': score,
        'confident': confident,
        'low_confidence': low_confidence,
        'trip_itinerary': _looks_like_trip_itinerary(text),
    }


def _scan_with_light_ocr(pdf_path):
    try:
        lines = run_ocr(pdf_to_images(pdf_path, max_pages=1))
    except Exception:
        lines = []
    text = '\n'.join(lines) if lines else ''
    score, strong_hits, _ = _scan_text_score(text)
    confident = len(strong_hits) >= 2 or score >= _SCAN_SCORE_CONFIDENT
    return {'score': score, 'confident': confident, 'trip_itinerary': _looks_like_trip_itinerary(text)}


def _classify_pdf_kind(pdf_path, mode='balanced'):
    qr_fields, qr_confident = _scan_with_qr(pdf_path, mode=mode)
    if qr_confident:
        return 'invoice'

    text_result = _scan_with_text(pdf_path, mode=mode)
    if text_result['trip_itinerary']:
        return 'trip_itinerary'
    if text_result['confident']:
        return 'invoice'

    allow_light_ocr = mode != 'fast'
    if allow_light_ocr and text_result['low_confidence']:
        ocr_result = _scan_with_light_ocr(pdf_path)
        if ocr_result['trip_itinerary']:
            return 'trip_itinerary'
        if ocr_result['confident']:
            return 'invoice'

    # QR 有部分字段时，放宽为候选发票（降低漏判）
    if mode in ('balanced', 'accurate') and (qr_fields.get('invoice_no') or qr_fields.get('total') is not None):
        return 'invoice'

    return 'other'

def _scan_one_pdf(args):
    pdf_path, mode = args
    return pdf_path, _classify_pdf_kind(pdf_path, mode=mode)


def scan_folder_for_invoices(folder_path, mode='balanced'):
    """递归扫描目录，返回所有 PDF 中属于发票的路径列表"""
    if mode not in _SCAN_MODE_SET:
        mode = 'balanced'

    pdf_paths = []
    for root, dirs, files in os.walk(folder_path):
        dirs.sort()
        for fname in sorted(files):
            if fname.lower().endswith('.pdf') and not fname.startswith('.'):
                pdf_paths.append(os.path.join(root, fname))

    invoices = []
    trip_itineraries = []
    non_invoices = []

    # fast 模式只做扫码+文本，允许并发以显著提速
    if mode == 'fast' and pdf_paths:
        workers = min(8, max(2, os.cpu_count() or 2))
        with ThreadPoolExecutor(max_workers=workers) as ex:
            for full_path, pdf_kind in ex.map(_scan_one_pdf, [(p, mode) for p in pdf_paths]):
                if pdf_kind == 'invoice':
                    invoices.append(full_path)
                elif pdf_kind == 'trip_itinerary':
                    trip_itineraries.append(full_path)
                else:
                    non_invoices.append(full_path)
    else:
        for full_path in pdf_paths:
            pdf_kind = _classify_pdf_kind(full_path, mode=mode)
            if pdf_kind == 'invoice':
                invoices.append(full_path)
            elif pdf_kind == 'trip_itinerary':
                trip_itineraries.append(full_path)
            else:
                non_invoices.append(full_path)

    return {
        'total': len(pdf_paths),
        'invoices': invoices,
        'trip_itineraries': trip_itineraries,
        'non_invoices': non_invoices,
    }


def main():
    if len(sys.argv) >= 3 and sys.argv[1] == '--scan':
        folder = sys.argv[2]
        mode = 'balanced'
        if '--mode' in sys.argv:
            mode_idx = sys.argv.index('--mode')
            if mode_idx + 1 < len(sys.argv):
                mode = sys.argv[mode_idx + 1].strip().lower()

        if not os.path.isdir(folder):
            print(json.dumps({'error': f'目录不存在: {folder}'}))
            sys.exit(1)
        if mode not in _SCAN_MODE_SET:
            print(json.dumps({'error': f'不支持的扫描模式: {mode}'}))
            sys.exit(1)
        result = scan_folder_for_invoices(folder, mode=mode)
        print(json.dumps(result, ensure_ascii=False))
        return

    if len(sys.argv) >= 2 and sys.argv[1] == '--server':
        # 常驻模式：预热 OCR 模型（只加载一次），然后循环处理请求
        try:
            get_ocr()
        except Exception as e:
            sys.stdout.write(json.dumps({'_init_error': str(e)}) + '\n')
            sys.stdout.flush()
            sys.exit(1)

        sys.stdout.write(json.dumps({'_ready': True}) + '\n')
        sys.stdout.flush()

        for line in sys.stdin:
            line = line.strip()
            if not line:
                continue
            req = {}
            try:
                req = json.loads(line)
                req_id = req.get('id', '')
                pdf_path = req.get('path', '')
                if not os.path.exists(pdf_path):
                    result = {'error': f'文件不存在: {pdf_path}'}
                else:
                    result = process(pdf_path)
                result['id'] = req_id
            except Exception as e:
                result = {'id': req.get('id', ''), 'error': str(e)}
            sys.stdout.write(json.dumps(result, ensure_ascii=False) + '\n')
            sys.stdout.flush()

    else:
        if len(sys.argv) < 2:
            print(json.dumps({'error': '用法: ocr.py <pdf_path>'}))
            sys.exit(1)
        pdf_path = sys.argv[1]
        if not os.path.exists(pdf_path):
            print(json.dumps({'error': f'文件不存在: {pdf_path}'}))
            sys.exit(1)
        try:
            result = process(pdf_path)
            print(json.dumps(result, ensure_ascii=False))
        except Exception as e:
            print(json.dumps({'error': str(e)}))
            sys.exit(1)


if __name__ == '__main__':
    main()
