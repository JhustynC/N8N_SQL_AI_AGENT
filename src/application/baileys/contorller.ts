// export class BaileysController {
//   private sock: WASocket | null = null;
//   private qrCodeData: string | null = null;
//   private isLoggedIn: boolean = false;
//   private connectionStatus: string = "Inicializando...";
//   private reconnectAttempts: number = 0;
//   private maxReconnectAttempts: number = 5;
//   private isReconnecting: boolean = false;

//   constructor() {}

//   public getSock(): WASocket | null {
//     return this.sock;
//   }

//   public getQrCodeData(): string | null {
//     return this.qrCodeData;
//   }

//   public getIsLoggedIn(): boolean {
//     return this.isLoggedIn;
//   }

//   public getConnectionStatus(): string {
//     return this.connectionStatus;
//   }

//   public getReconnectAttempts(): number {
//     return this.reconnectAttempts;
//   }

//   public getMaxReconnectAttempts(): number {
//     return this.maxReconnectAttempts;
//   }

//   public getIsReconnecting(): boolean {
//     return this.isReconnecting;
//   }

//   public setSock(sock: WASocket | null): void {
//     this.sock = sock;
//   }

//   public setQrCodeData(qrCodeData: string | null): void {
//     this.qrCodeData = qrCodeData;
//   }

//   public setIsLoggedIn(isLoggedIn: boolean): void {
//     this.isLoggedIn = isLoggedIn;
//   }

//   public setConnectionStatus(status: string): void {
//     this.connectionStatus = status;
//   }

//   public incrementReconnectAttempts(): void {
//     this.reconnectAttempts++;
//   }

//   public resetReconnectAttempts(): void {
//     this.reconnectAttempts = 0;
//   }

//   public setIsReconnecting(isReconnecting: boolean): void {
//     this.isReconnecting = isReconnecting;
//   }

// }
