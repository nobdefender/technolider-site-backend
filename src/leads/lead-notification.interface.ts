/** Заявка в виде, пригодном для отправки в почту и Telegram. */
export interface LeadNotification {
  id: string;
  createdAt: Date;
  name: string;
  phone: string;
  email?: string | null;
  task: string;
  page?: string | null;
  ip?: string | null;
  files: { originalName: string; storedName: string; mimeType: string; size: number }[];
}
