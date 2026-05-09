require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');
const sgMail = require('@sendgrid/mail');

// Configurar SendGrid
if (process.env.SENDGRID_API_KEY) {
  sgMail.setApiKey(process.env.SENDGRID_API_KEY);
}

// Generar código único
function generarCodigo() {
  return 'RES-' + Math.random().toString(36).substring(2, 8).toUpperCase();
}

const app = express();
const PORT = process.env.PORT || 3000;

// Configuración Supabase
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://xftcenmlptzhxhffwtsk.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_KEY || 'sb_secret_GowxJgT7b0E_ApXz2AtUJw_PIpjgVCh';
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// Middleware
app.use(cors());
app.use(express.json());

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ============ ESPACIOS ============
app.get('/api/espacios', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('espacios')
      .select('*')
      .order('nombre');
    
    if (error) throw error;
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============ RESERVAS ============

// Obtener todas las reservas (para el calendario)
app.get('/api/reservas', async (req, res) => {
  try {
    const { espacio_id, fecha } = req.query;
    let query = supabase
      .from('reservas')
      .select('*')
      .eq('estado', 'activa');

    if (espacio_id) query = query.eq('espacio_id', espacio_id);
    if (fecha) query = query.eq('fecha', fecha);

    const { data, error } = await query;
    if (error) throw error;
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Validar disponibilidad de un horario
app.post('/api/validar-disponibilidad', async (req, res) => {
  try {
    const { espacio_id, fecha, hora } = req.body;

    if (!espacio_id || !fecha || !hora) {
      return res.status(400).json({ error: 'Faltan parámetros' });
    }

    // Verificar que no exista reserva en ese horario
    const { data: conflicto, error } = await supabase
      .from('reservas')
      .select('id')
      .eq('espacio_id', espacio_id)
      .eq('fecha', fecha)
      .eq('hora_inicio', hora)
      .eq('estado', 'activa');

    if (error) throw error;

    if (conflicto && conflicto.length > 0) {
      return res.json({ disponible: false, mensaje: 'Este horario ya está reservado' });
    }

    res.json({ disponible: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Crear nueva reserva
app.post('/api/reservas', async (req, res) => {
  try {
    const { espacio_id, nombre_solicitante, contacto, fecha, hora_inicio, hora_fin, motivo } = req.body;

    console.log('Datos recibidos:', { espacio_id, nombre_solicitante, contacto, fecha, hora_inicio, hora_fin, motivo });

    // Validaciones
    if (!espacio_id || !nombre_solicitante || !contacto || !fecha || !hora_inicio || !hora_fin) {
      return res.status(400).json({ error: 'Faltan datos obligatorios' });
    }

    // Validación: Anticipación mínima (1 día)
    const hoy = new Date();
    hoy.setHours(0, 0, 0, 0);
    const fechaReserva = new Date(fecha);
    const diasDiferencia = Math.floor((fechaReserva - hoy) / (1000 * 60 * 60 * 24));

    if (diasDiferencia < 1) {
      return res.status(400).json({ error: 'La reserva debe hacerse con al menos 1 día de anticipación' });
    }

    // Validación: No es fin de semana
    if (fechaReserva.getDay() === 0 || fechaReserva.getDay() === 6) {
      return res.status(400).json({ error: 'No se pueden hacer reservas para fines de semana' });
    }

    // Validación: Horario dentro de 08:00-17:00
    const [hora, minuto] = hora_inicio.split(':').map(Number);
    if (hora < 8 || hora >= 17) {
      return res.status(400).json({ error: 'El horario debe estar entre 08:00 y 17:00' });
    }

    // Verificar disponibilidad: que no haya solapamiento con reservas existentes
    const { data: conflictos } = await supabase
      .from('reservas')
      .select('id, hora_inicio, hora_fin')
      .eq('espacio_id', espacio_id)
      .eq('fecha', fecha)
      .eq('estado', 'activa');

    if (conflictos && conflictos.length > 0) {
      // Verificar si se solapa con alguna reserva existente
      const [horaIni, minIni] = hora_inicio.split(':').map(Number);
      const [horaFin, minFin] = hora_fin.split(':').map(Number);
      const tiempoInicio = horaIni * 60 + minIni;
      const tiempoFin = horaFin * 60 + minFin;

      for (const conflicto of conflictos) {
        const [horaExist, minExist] = conflicto.hora_inicio.split(':').map(Number);
        const [horaExistFin, minExistFin] = conflicto.hora_fin.split(':').map(Number);
        const tiempoExist = horaExist * 60 + minExist;
        const tiempoExistFin = horaExistFin * 60 + minExistFin;

        // Verificar solapamiento
        if (tiempoInicio < tiempoExistFin && tiempoFin > tiempoExist) {
          return res.status(400).json({ error: 'Este horario se solapa con una reserva existente' });
        }
      }
    }

    // Insertar la reserva
    const codigo = generarCodigo();
    const { data: nuevaReserva, error } = await supabase
      .from('reservas')
      .insert([{
        espacio_id,
        nombre_solicitante,
        contacto,
        fecha,
        hora_inicio,
        hora_fin,
        motivo: motivo || '',
        estado: 'activa',
        codigo_cancelacion: codigo
      }])
      .select();

    if (error) throw error;

    // Enviar email con detalles de la reserva
    const [emailUser] = contacto.split('|').map(c => c.trim());
    const espacios_map = { 1: 'Altillo', 2: 'Sala de Reuniones', 3: 'Frente' };
    
    if (sgMail && process.env.SENDGRID_API_KEY) {
      try {
        await sgMail.send({
          to: emailUser,
          from: 'noreply@onrender.com',
          subject: '✓ Tu reserva en Centro de Estudiantes de Química',
          html: `
            <h2>Reserva Confirmada</h2>
            <p>Hola <strong>${nombre_solicitante}</strong>,</p>
            <p>Tu reserva ha sido registrada exitosamente:</p>
            <hr>
            <table style="border-collapse: collapse;">
              <tr>
                <td style="padding: 8px;"><strong>Espacio:</strong></td>
                <td style="padding: 8px;">${espacios_map[espacio_id]}</td>
              </tr>
              <tr>
                <td style="padding: 8px;"><strong>Fecha:</strong></td>
                <td style="padding: 8px;">${new Date(fecha).toLocaleDateString('es-PY')}</td>
              </tr>
              <tr>
                <td style="padding: 8px;"><strong>Horario:</strong></td>
                <td style="padding: 8px;">${hora_inicio} - ${hora_fin}</td>
              </tr>
              <tr>
                <td style="padding: 8px;"><strong>Motivo:</strong></td>
                <td style="padding: 8px;">${motivo || 'Sin especificar'}</td>
              </tr>
              <tr style="background: #f0f0f0;">
                <td style="padding: 8px;"><strong>Código de Cancelación:</strong></td>
                <td style="padding: 8px; font-weight: bold; color: #d86060;">${codigo}</td>
              </tr>
            </table>
            <hr>
            <p><small>Guarda este código si deseas cancelar tu reserva.</small></p>
          `
        });
      } catch (emailError) {
        console.error('Error al enviar email:', emailError);
        // No falles la reserva si falla el email
      }
    }

    res.status(201).json({
      mensaje: 'Reserva creada exitosamente',
      reserva: nuevaReserva[0]
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============ ADMIN ============

// Obtener todas las reservas (admin)
app.get('/api/admin/reservas', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('reservas')
      .select(`
        id,
        espacio_id,
        espacios(nombre),
        nombre_solicitante,
        contacto,
        fecha,
        hora_inicio,
        hora_fin,
        estado,
        motivo,
        created_at
      `)
      .order('fecha', { ascending: false });

    if (error) throw error;
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Cancelar reserva (admin)
app.post('/api/admin/cancelar/:reserva_id', async (req, res) => {
  try {
    const { reserva_id } = req.params;
    const { motivo } = req.body;

    // Obtener la reserva
    const { data: reserva, error: errorReserva } = await supabase
      .from('reservas')
      .select('fecha, hora_inicio')
      .eq('id', reserva_id)
      .single();

    if (errorReserva) throw errorReserva;

    // Verificar si aplica multa (cancelación con menos de 2 días)
    const hoy = new Date();
    hoy.setHours(0, 0, 0, 0);
    const fechaReserva = new Date(reserva.fecha);
    const diasDiferencia = Math.floor((fechaReserva - hoy) / (1000 * 60 * 60 * 24));
    const aplicaMulta = diasDiferencia < 2;

    // Actualizar estado de la reserva
    const { error: errorUpdate } = await supabase
      .from('reservas')
      .update({ estado: 'cancelada' })
      .eq('id', reserva_id);

    if (errorUpdate) throw errorUpdate;

    // Registrar cancelación
    const { error: errorCancelacion } = await supabase
      .from('cancelaciones')
      .insert([{
        reserva_id,
        motivo,
        aplica_multa: aplicaMulta
      }]);

    if (errorCancelacion) throw errorCancelacion;

    res.json({
      mensaje: 'Reserva cancelada',
      aplica_multa: aplicaMulta
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============ ESTADÍSTICAS ============

app.get('/api/estadisticas', async (req, res) => {
  try {
    // Total de reservas activas
    const { data: activas } = await supabase
      .from('reservas')
      .select('id')
      .eq('estado', 'activa');

    // Total de cancelaciones
    const { data: cancelaciones } = await supabase
      .from('cancelaciones')
      .select('id');

    // Cancelaciones con multa
    const { data: conMulta } = await supabase
      .from('cancelaciones')
      .select('id')
      .eq('aplica_multa', true);

    res.json({
      reservas_activas: activas?.length || 0,
      cancelaciones_totales: cancelaciones?.length || 0,
      cancelaciones_con_multa: conMulta?.length || 0
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Crear reporte de error
app.post('/api/reportes', async (req, res) => {
  try {
    const { mensaje, url, navegador } = req.body;

    if (!mensaje) {
      return res.status(400).json({ error: 'Mensaje requerido' });
    }

    const { data, error } = await supabase
      .from('reportes_errores')
      .insert([{
        mensaje,
        url: url || '',
        navegador: navegador || '',
        leido: false
      }])
      .select();

    if (error) throw error;

    res.status(201).json({ mensaje: 'Reporte guardado', reporte: data[0] });
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Obtener reportes de errores (admin)
app.get('/api/admin/reportes', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('reportes_errores')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) throw error;
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Marcar reporte como leído
app.post('/api/admin/reportes/:id/leer', async (req, res) => {
  try {
    const { id } = req.params;

    const { data, error } = await supabase
      .from('reportes_errores')
      .update({ leido: true })
      .eq('id', id)
      .select();

    if (error) throw error;
    res.json({ mensaje: 'Marcado como leído', reporte: data[0] });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Cancelar reserva por código
app.post('/api/cancelar-por-codigo', async (req, res) => {
  try {
    const { codigo, motivo } = req.body;

    if (!codigo) {
      return res.status(400).json({ error: 'Código requerido' });
    }

    // Buscar la reserva por código
    const { data: reservas, error: errorBuscar } = await supabase
      .from('reservas')
      .select('*')
      .eq('codigo_cancelacion', codigo)
      .eq('estado', 'activa');

    if (errorBuscar || !reservas || reservas.length === 0) {
      return res.status(404).json({ error: 'Código inválido o reserva ya cancelada' });
    }

    const reserva = reservas[0];

    // Cancelar la reserva
    const { error: errorCancelar } = await supabase
      .from('reservas')
      .update({ estado: 'cancelada' })
      .eq('id', reserva.id);

    if (errorCancelar) throw errorCancelar;

    res.json({ mensaje: 'Reserva cancelada exitosamente', reserva_id: reserva.id });
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Iniciar servidor
app.listen(PORT, () => {
  console.log(`Servidor corriendo en puerto ${PORT}`);
});
