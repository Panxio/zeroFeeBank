import { Controller, Get, Put, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { AuthService } from '../auth/auth.service.js';
import { ContactoService } from './contacto.service.js';

@Controller('contacto')
export class ContactoController {
  constructor(
    private readonly authService: AuthService,
    private readonly contactoService: ContactoService,
  ) {}

  private async extraerTitular(req: Request): Promise<{ id: string; email: string }> {
    return this.authService.yo(req.headers['authorization']);
  }

  @Get()
  async obtener(@Req() req: Request, @Res() res: Response): Promise<void> {
    const titular = await this.extraerTitular(req);
    const contacto = await this.contactoService.obtenerContacto(titular.id);
    res.status(200).json(contacto);
  }

  @Put()
  async actualizar(@Req() req: Request, @Res() res: Response): Promise<void> {
    const titular = await this.extraerTitular(req);
    const contacto = await this.contactoService.actualizarContacto(
      titular.id,
      titular.email,
      req.body,
    );
    res.status(200).json(contacto);
  }
}
