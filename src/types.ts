export interface ProjectFile {
  path: string;
  name: string;
  category: 'kotlin' | 'gradle' | 'manifest' | 'web' | 'xml' | 'doc' | 'assets';
  language: string;
  description: string;
  content: string;
}

export interface BillingLogItem {
  id: string;
  timestamp: string;
  tag:
    | 'CafeBazaarBilling'
    | 'WebAppConsole'
    | 'PoolakeySDK'
    | 'TapsellManager'
    | 'PushfaManager'
    | 'LocalWebServer'
    | 'Container';
  level: 'D' | 'I' | 'W' | 'E';
  message: string;
}

export interface SimulatedPurchase {
  productId: string;
  purchaseToken: string;
  orderId: string;
  purchaseTime: number;
  consumed: boolean;
}

export type BootStage =
  | 'idle'
  | 'server'
  | 'webview'
  | 'webapp'
  | 'ready'
  | 'error';

export interface AdEventItem {
  id: string;
  type: string;
  detail: string;
  ok: boolean;
  at: string;
}
