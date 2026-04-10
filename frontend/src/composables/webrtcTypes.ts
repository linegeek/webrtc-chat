export interface Message {
  text: string
  type: 'self' | 'peer' | 'system'
}

export interface TransferProgress {
  visible: boolean
  label:   string
  value:   number
  max:     number
  text:    string
}
