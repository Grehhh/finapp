import {
  CanActivate,
  ExecutionContext,
  Injectable,
  ServiceUnavailableException,
  SetMetadata,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { timingSafeEqual } from 'node:crypto';

const PUBLIC_ROUTE = 'finapp:public-route';

export const PublicRoute = () => SetMetadata(PUBLIC_ROUTE, true);

@Injectable()
export class ApiTokenGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(PUBLIC_ROUTE, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const expectedToken = process.env.FINAPP_API_TOKEN;
    if (!expectedToken) {
      throw new ServiceUnavailableException(
        'API authentication is not configured.',
      );
    }
    const expected = Buffer.from(expectedToken);
    if (expected.length < 32) {
      throw new ServiceUnavailableException(
        'FINAPP_API_TOKEN must contain at least 32 bytes.',
      );
    }

    const request = context.switchToHttp().getRequest<{
      headers: { authorization?: string };
    }>();
    const authorization = request.headers.authorization;
    const suppliedToken = authorization?.match(/^Bearer\s+(.+)$/i)?.[1];

    if (!suppliedToken) {
      throw new UnauthorizedException('A valid API token is required.');
    }

    const supplied = Buffer.from(suppliedToken);
    if (
      expected.length !== supplied.length ||
      !timingSafeEqual(expected, supplied)
    ) {
      throw new UnauthorizedException('A valid API token is required.');
    }

    return true;
  }
}
