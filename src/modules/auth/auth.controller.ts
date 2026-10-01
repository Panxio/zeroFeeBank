import * as fs from 'node:fs';
import * as path from 'node:path';
import { Controller, Get, HttpStatus, Param, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { AuthService } from './auth.service.js';
import { generarHtmlMarco } from './marco.pagina.js';
import { obtenerOrigenApp } from '../../infra/origen-app.js';

const FUENTES_MAP: Readonly<Record<string, string>> = {
  'jost-400.woff2': 'node_modules/@fontsource/jost/files/jost-latin-400-normal.woff2',
  'jost-500.woff2': 'node_modules/@fontsource/jost/files/jost-latin-500-normal.woff2',
};

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Get('marco/fuentes/:archivo')
  fuente(@Param('archivo') archivo: string, @Res() res: Response): void {
    const rutaRelativa = FUENTES_MAP[archivo];
    if (!rutaRelativa) {
      res.status(HttpStatus.NOT_FOUND).send('Not Found');
      return;
    }
    const rutaAbsoluta = path.resolve(process.cwd(), rutaRelativa);
    const buf = fs.readFileSync(rutaAbsoluta);
    res
      .status(HttpStatus.OK)
      .type('font/woff2')
      .send(buf);
  }

  @Get('marco')
  marco(@Res() res: Response): void {
    const origen = obtenerOrigenApp();
    res
      .status(HttpStatus.OK)
      .type('text/html; charset=utf-8')
      .set('Content-Security-Policy', `frame-ancestors ${origen}`)
      .send(generarHtmlMarco(origen));
  }

  @Post('registro')
  async registro(@Req() req: Request, @Res() res: Response): Promise<void> {
    const resultado = await this.authService.registrar(req.body);
    res.status(HttpStatus.CREATED).json(resultado);
  }

  @Post('login')
  async login(@Req() req: Request, @Res() res: Response): Promise<void> {
    const resultado = await this.authService.login(req.body);
    res.status(HttpStatus.OK).json(resultado);
  }

  @Get('yo')
  async yo(@Req() req: Request, @Res() res: Response): Promise<void> {
    const authHeader = req.headers['authorization'];
    const resultado = await this.authService.yo(authHeader);
    res.status(HttpStatus.OK).json(resultado);
  }
}

