export type InvoiceCategory = '城市间交通' | '打车' | '住宿' | '餐饮外卖'

export type InvoiceType =
  | '增值税普通发票'
  | '增值税专用发票'
  | '行程单'
  | '酒店发票'
  | '出租车票'
  | '其他'

export type InvoiceAttachmentDocType = 'trip_itinerary'

export interface Invoice {
  id: string
  filePath: string
  fileHash: string
  invoiceNo: string | null
  date: string | null // YYYY-MM-DD
  vendor: string | null
  vendorTaxId: string | null
  amount: number | null
  tax: number | null
  total: number | null
  category: InvoiceCategory
  projectTag: string | null
  note: string | null
  invoiceType: InvoiceType | null
  ocrRaw: string | null
  createdAt: string
  attachmentCount: number
}

export interface InvoiceAttachment {
  id: string
  invoiceId: string
  filePath: string
  docType: InvoiceAttachmentDocType
  sourceName: string | null
  createdAt: string
}

export interface TripItinerarySuggestion {
  invoiceId: string
  vendor: string | null
  date: string | null
  total: number | null
  score: number
}

export interface UnmatchedTripItinerary {
  filePath: string
  detectedAmount: number | null
  detectedDate: string | null
  detectedVendor: string | null
  reason: string
  suggestions: TripItinerarySuggestion[]
}

export interface Project {
  id: string
  name: string
  color: string
}

export interface OcrResult {
  invoice_no: string | null
  date: string | null
  vendor: string | null
  vendor_tax_id: string | null
  amount: number | null
  tax: number | null
  total: number | null
  category: InvoiceCategory | null
  invoice_type: InvoiceType | null
}

export interface ReportFilter {
  startDate?: string
  endDate?: string
  projectTag?: string
  categories?: InvoiceCategory[]
}

export interface AppSettings {
  pythonPath: string
  dataDir: string
  exporterName: string
  companyName: string
}
