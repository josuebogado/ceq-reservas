require('dotenv').config();

const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');
const nodemailer = require('nodemailer');

const app = express();

const PORT = process.env.PORT || 3000;

// =========================
// SUPABASE
// =========================

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;

const supabase = createClient(
  SUPABASE_URL,
  SUPABASE_KEY
);

// =========================
// MIDDLEWARE
// =========================

app.use(cors());
app.use(express.json());

// =========================
// NODEMAILER
// =========================

const transporter = nodemailer.createTransport({

  service: 'gmail',

  auth: {

    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS

  }

});

// =========================
// GENERAR CÓDIGO
// =========================

function generarCodigo() {

  return 'RES-' +

    Math.random()
      .toString(36)
      .substring(2, 8)
      .toUpperCase();

}

// =========================
// HEALTH CHECK
// =========================

app.get('/api/health', (req, res) => {

  res.json({

    status: 'ok',

    timestamp: new Date().toISOString()

  });

});

// =========================
// ESPACIOS
// =========================

app.get('/api/espacios', async (req, res) => {

  try {

    const { data, error } = await supabase

      .from('espacios')

      .select('*')

      .order('nombre');

    if (error) throw error;

    res.json(data);

  } catch (error) {

    res.status(500).json({

      error: error.message

    });

  }

});

// =========================
// OBTENER RESERVAS
// =========================

app.get('/api/reservas', async (req, res) => {

  try {

    const { espacio_id, fecha } = req.query;

    let query = supabase

      .from('reservas')

      .select('*')

      .eq('estado', 'activa');

    if (espacio_id) {

      query = query.eq('espacio_id', espacio_id);

    }

    if (fecha) {

      query = query.eq('fecha', fecha);

    }

    const { data, error } = await query;

    if (error) throw error;

    res.json(data);

  } catch (error) {

    res.status(500).json({

      error: error.message

    });

  }

});

// =========================
// CREAR RESERVA
// =========================

app.post('/api/reservas', async (req, res) => {

  try {

    const {

      espacio_id,
      nombre_solicitante,
      contacto,
      fecha,
      turno,
      motivo

    } = req.body;

    console.log('Datos recibidos:', {

      espacio_id,
      nombre_solicitante,
      contacto,
      fecha,
      turno,
      motivo

    });

    // =========================
    // VALIDACIONES
    // =========================

    if (

      !espacio_id ||
      !nombre_solicitante ||
      !contacto ||
      !fecha ||
      !turno

    ) {

      return res.status(400).json({

        error: 'Faltan datos obligatorios'

      });

    }

    // =========================
    // VALIDAR FECHA
    // =========================

    const hoy = new Date();

    hoy.setHours(0, 0, 0, 0);

    const fechaReserva = new Date(fecha);

    const diasDiferencia = Math.floor(

      (fechaReserva - hoy) /

      (1000 * 60 * 60 * 24)

    );

    // mínimo 1 día

    if (diasDiferencia < 1) {

      return res.status(400).json({

        error:
          'La reserva debe hacerse con 1 día de anticipación'

      });

    }

    // máximo 14 días

    if (diasDiferencia > 14) {

      return res.status(400).json({

        error:
          'Solo se puede reservar hasta 14 días adelante'

      });

    }

    // no fines de semana

    if (

      fechaReserva.getDay() === 0 ||
      fechaReserva.getDay() === 6

    ) {

      return res.status(400).json({

        error:
          'No se permiten reservas en fines de semana'

      });

    }

    // =========================
    // TURNOS FIJOS
    // =========================

    let hora_inicio;
    let hora_fin;

    switch (turno) {

      case 'desayuno':

        hora_inicio = '07:00';
        hora_fin = '10:00';

        break;

      case 'almuerzo':

        hora_inicio = '10:00';
        hora_fin = '13:00';

        break;

      case 'merienda':

        hora_inicio = '14:00';
        hora_fin = '18:00';

        break;

      default:

        return res.status(400).json({

          error: 'Turno inválido'

        });

    }

    // =========================
    // CREAR RESERVA
    // =========================

    const codigo = generarCodigo();

    const {

      data: nuevaReserva,
      error

    } = await supabase

      .from('reservas')

      .insert([{

        espacio_id,

        nombre_solicitante,

        contacto,

        fecha,

        turno,

        hora_inicio,

        hora_fin,

        motivo: motivo || '',

        estado: 'activa',

        codigo_cancelacion: codigo

      }])

      .select();

    // =========================
    // ERROR DUPLICADO
    // =========================

    if (error) {

      if (error.code === '23505') {

        return res.status(409).json({

          error:
            'Ese turno ya fue reservado por otra persona'

        });

      }

      console.error('Error Supabase:', error);

      throw error;

    }

    // =========================
    // EMAIL
    // =========================

    const [emailUser] = contacto

      .split('|')

      .map(c => c.trim());

    const espacios_map = {

      1: 'Altillo',

      2: 'Sala de Reuniones',

      3: 'Frente'

    };

    try {

      await transporter.sendMail({

        from: process.env.EMAIL_USER,

        to: emailUser,

        subject: '✓ Reserva Confirmada',

        html: `

          <h2>Reserva Confirmada</h2>

          <p>

            Hola
            <strong>${nombre_solicitante}</strong>

          </p>

          <hr>

          <p>

            <strong>Espacio:</strong>

            ${espacios_map[espacio_id]}

          </p>

          <p>

            <strong>Fecha:</strong>

            ${new Date(fecha).toLocaleDateString('es-PY')}

          </p>

          <p>

            <strong>Turno:</strong>

            ${turno}

          </p>

          <p>

            <strong>Horario:</strong>

            ${hora_inicio} - ${hora_fin}

          </p>

          <p>

            <strong>Motivo:</strong>

            ${motivo || 'Sin especificar'}

          </p>

          <hr>

          <p>

            <strong>Código:</strong>

            ${codigo}

          </p>

        `

      });

    } catch (emailError) {

      console.error(

        'Error enviando email:',

        emailError

      );

    }

    // =========================
    // RESPUESTA
    // =========================

    res.status(201).json({

      mensaje: 'Reserva creada exitosamente',

      reserva: nuevaReserva[0]

    });

  } catch (error) {

    console.error(error);

    res.status(500).json({

      error: error.message

    });

  }

});

// =========================
// INICIAR SERVIDOR
// =========================

app.listen(PORT, () => {

  console.log(

    `Servidor corriendo en puerto ${PORT}`

  );

});