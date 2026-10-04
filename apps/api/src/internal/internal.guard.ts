import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';

@Injectable()
export class InternalGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest();
    const key = process.env.INTERNAL_API_KEY || '';
    const got = req.headers['x-internal-key'] || req.headers['x-api-key'];
    if (!key || got !== key) throw new UnauthorizedException('Invalid internal key');
    return true;
  }
}
