import { type CanActivate, type ExecutionContext, Injectable, UnauthorizedException, createParamDecorator } from '@nestjs/common'
import type { Request } from 'express'

/** 예제라 로그인 대신 x-user-id 머리로 사용자를 정한다 */
@Injectable()
export class UserGuard implements CanActivate {
  canActivate(context: ExecutionContext) {
    const req = context.switchToHttp().getRequest<Request & { userId?: number }>()
    const id = Number(req.headers['x-user-id'])
    if (!Number.isSafeInteger(id) || id <= 0) throw new UnauthorizedException({ code: 'UNAUTHORIZED', message: '사용자가 없다' })
    req.userId = id
    return true
  }
}

export const UserId = createParamDecorator((_: unknown, context: ExecutionContext) => context.switchToHttp().getRequest<{ userId: number }>().userId)
