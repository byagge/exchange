import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { createHash } from 'crypto';

/** Shared bot↔API secret. Auto-derived from BOT_TOKEN if INTERNAL_API_KEY unset. */
export function resolveInternalKey(): string {
  const explicit = (process.env.INTERNAL_API_KEY || '').trim();
  if (explicit) return explicit;
  const seed = process.env.BOT_TOKEN || process.env.JWT_SECRET || 'exchange-internal';
  return createHash('sha256').update(`ex-internal:${seed}`).digest('hex').slice(0, 48);
}

@Injectable()
export class InternalGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest();
    const key = resolveInternalKey();
    const got = req.headers['x-internal-key'] || req.headers['x-api-key'];
    if (!key || got !== key) throw new UnauthorizedException('Invalid internal key');
    return true;
  }
}
