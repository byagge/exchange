import { existsSync, mkdirSync } from 'fs';
import { diskStorage } from 'multer';
import type { Request } from 'express';
import { randomBytes } from 'crypto';

export type ProofAttachment = {
  url: string;
  name: string;
  mime: string;
  size: number;
};

export function uploadsRoot() {
  const dir = process.env.UPLOADS_DIR || 'C:/exdb/uploads';
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

const IMAGE_OK = (m: string) => m.startsWith('image/');
const DOC_OK = (m: string) =>
  m === 'application/pdf' ||
  m === 'application/msword' ||
  m === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
  m === 'application/vnd.ms-excel' ||
  m === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
  m === 'text/plain';
const VIDEO_OK = (m: string) =>
  m === 'video/mp4' ||
  m === 'video/quicktime' ||
  m === 'video/webm' ||
  m === 'video/x-msvideo' ||
  m === 'video/3gpp';

function safeFilename(original: string) {
  const safe = original.replace(/[^\w.\-()+а-яА-ЯёЁ ]+/gi, '_').slice(0, 60);
  const token = randomBytes(8).toString('hex');
  return `${Date.now()}-${token}-${safe}`;
}

/** Пруфы оператора: фото + документы */
export function proofUploadOptions() {
  return {
    storage: diskStorage({
      destination: (_req, _file, cb) => cb(null, uploadsRoot()),
      filename: (_req, file, cb) => cb(null, safeFilename(file.originalname)),
    }),
    limits: { fileSize: 12 * 1024 * 1024, files: 5 },
    fileFilter: (
      _req: Request,
      file: Express.Multer.File,
      cb: (error: Error | null, acceptFile: boolean) => void,
    ) => {
      const ok = IMAGE_OK(file.mimetype) || DOC_OK(file.mimetype);
      cb(ok ? null : new Error('Допустимы фото и документы (PDF, Word, Excel, TXT)'), ok);
    },
  };
}

/** Клиентские доказательства после таймера: видео + фото */
export function clientProofUploadOptions() {
  return {
    storage: diskStorage({
      destination: (_req, _file, cb) => cb(null, uploadsRoot()),
      filename: (_req, file, cb) => cb(null, safeFilename(file.originalname)),
    }),
    limits: { fileSize: 64 * 1024 * 1024, files: 3 },
    fileFilter: (
      _req: Request,
      file: Express.Multer.File,
      cb: (error: Error | null, acceptFile: boolean) => void,
    ) => {
      const ok = VIDEO_OK(file.mimetype) || IMAGE_OK(file.mimetype);
      cb(ok ? null : new Error('Допустимы видео (MP4, MOV, WebM) и фото'), ok);
    },
  };
}

export function mapUploadedFiles(files?: Express.Multer.File[]): ProofAttachment[] {
  if (!files?.length) return [];
  return files.map((f) => ({
    url: `/uploads/${f.filename}`,
    name: f.originalname,
    mime: f.mimetype,
    size: f.size,
  }));
}
