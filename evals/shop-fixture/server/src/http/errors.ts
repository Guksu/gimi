import { HttpException } from '@nestjs/common'

/** 화면이 코드로 갈라 보이는 오류 — { code, message } */
export const fail = (status: number, code: string, message: string) => new HttpException({ code, message }, status)
