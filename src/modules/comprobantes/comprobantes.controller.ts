import { Controller, Get, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { AuthService } from '../auth/auth.service.js';
import { ComprobantesService } from './comprobantes.service.js';

function extraerIdParam(req: Request): string {
  const idRaw = req.params['id'];
  return typeof idRaw === 'string' ? idRaw : '';
}

@Controller()
export class ComprobantesController {
  constructor(
    private readonly authService: AuthService,
    private readonly comprobantesService: ComprobantesService,
  ) {}

  @Get('transferencias/:id/comprobante.pdf')
  async comprobanteTransferencia(
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const titular = await this.authService.yo(req.headers['authorization']);
    const id = extraerIdParam(req);
    const pdf = await this.comprobantesService.comprobanteTransferencia(titular.id, id);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `inline; filename="transferencia-${id}-comprobante.pdf"`,
    );
    res.status(200).end(pdf);
  }

  @Get('boletas/:id/comprobante.pdf')
  async comprobanteBoleta(
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const titular = await this.authService.yo(req.headers['authorization']);
    const id = extraerIdParam(req);
    const pdf = await this.comprobantesService.comprobanteBoleta(titular.id, id);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="boleta-${id}-comprobante.pdf"`,
    );
    res.status(200).end(pdf);
  }

  @Get('boletas/:id/resumen.pdf')
  async resumenBoleta(
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const titular = await this.authService.yo(req.headers['authorization']);
    const id = extraerIdParam(req);
    const pdf = await this.comprobantesService.resumenBoleta(titular.id, id);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="boleta-${id}-resumen.pdf"`,
    );
    res.status(200).end(pdf);
  }
}
