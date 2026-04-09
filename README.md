# 发票整理工具（invoices-tool）

本项目是一个基于 **Electron + React + TypeScript** 的桌面端发票整理应用，面向日常报销场景，支持本地 PDF 发票管理、识别提取、分类筛选和报销材料导出。

## 主要功能

- 批量导入 PDF（文件选择或文件夹扫描）
- 基于文件哈希（MD5）自动去重
- 导入后自动识别并回填字段（发票号、日期、销售方、税号、金额等）
- 导入/识别过程实时进度显示（不会无反馈“卡住”）
- 支持打车行程单作为附件绑定到打车发票，导出报销包时一并导出
- 批量导入时可自动识别打车行程单，并尝试按金额、日期、平台信息自动绑定
- 自动绑定失败时，提供候选发票复核面板，可直接手动补绑
- 支持手动“重新识别”（详情页按钮 + 列表高级操作）
- 手动编辑发票信息（日期、金额、类型、分类、项目标签、备注等）
- 按关键字、分类、项目、日期筛选
- 导出 Excel 报销单（明细 + 分类汇总 + 封面）
- 导出 ZIP 报销包（Excel + 按分类归档的 PDF）

## 技术栈

- 桌面框架：Electron 33
- 前端：React 18 + Vite + TailwindCSS + Zustand
- 本地数据库：sql.js（SQLite）
- 导出：ExcelJS、Archiver
- OCR：Python + PaddleOCR + PyMuPDF

## 环境要求

### Node.js

- 建议 Node.js `>= 20`
- npm `>= 10`

### Python（用于 OCR）

- Python `>= 3.9`
- 安装依赖：

```bash
pip install paddleocr paddlepaddle pymupdf opencv-python-headless
```

说明：
- 应用中可在「设置 -> OCR 设置」中填写 Python 路径并点击「检测」。
- 若 Python 环境不可用，仍可导入文件，但识别会失败并在结果里统计失败数量。

## 本地开发

```bash
npm install
npm run dev
```

常用命令：

```bash
npm run build      # 构建前后端产物到 out/
npm run dist:mac   # 打包 macOS arm64 (dmg)
npm run dist:win   # 打包 Windows x64 (nsis exe)
```

## 使用流程

1. 导入发票 PDF（单个或批量）
2. 系统自动执行识别并实时显示进度
3. 批量导入时会额外识别打车行程单，并自动尝试绑定到对应打车发票
4. 如存在未自动绑定的行程单，可在复核弹窗中直接补绑
5. 在右侧编辑区修正识别结果（如有需要可“重新识别”）
6. 设置项目标签、分类、备注等
7. 通过筛选面板选定报销范围
8. 生成 Excel 报销单或 ZIP 报销包

## 扫描说明

- 批量导入前会先扫描目录中的 PDF，默认使用 `fast` 模式（极速优先）。
- `fast` 模式采用“扫码 + 文本提取”判断，速度快，适合大批量。
- 开发侧接口支持 `balanced` / `accurate` 模式，召回更高但更慢。
- 扫描结果会区分普通发票、打车行程单和非发票文件。

## 打车行程单

- 行程单不会作为独立报销金额参与统计，只作为打车发票的附件存在。
- 在发票详情中，只有 `打车` 分类会显示“行程单附件”区域。
- 导出 ZIP 报销包时，主发票和已绑定行程单会放在同一个目录下。

## 本地数据存储

应用数据保存在 Electron `userData` 目录下：

- 数据库：`<userData>/data/invoices.sqlite`
- 发票文件：`<userData>/invoices/*.pdf`
