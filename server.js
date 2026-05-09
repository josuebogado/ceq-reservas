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
    // VALIDACIÓN FECHA
    // =========================

    const hoy = new Date();

    hoy.setHours(0, 0, 0, 0);

    const fechaReserva = new Date(fecha);

    const diasDiferencia = Math.floor(
      (fechaReserva - hoy) / (1000 * 60 * 60 * 24)
    );

    // mínimo 1 día
    if (diasDiferencia < 1) {

      return res.status(400).json({
        error: 'La reserva debe hacerse con al menos 1 día de anticipación'
      });

    }

    // máximo 14 días
    if (diasDiferencia > 14) {

      return res.status(400).json({
        error: 'Solo se puede reservar hasta 14 días adelante'
      });

    }

    // no fines de semana
    if (
      fechaReserva.getDay() === 0 ||
      fechaReserva.getDay() === 6
    ) {

      return res.status(400).json({
        error: 'No se permiten reservas para fines de semana'
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

    const { data: nuevaReserva, error } = await supabase

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
    // ERROR DE DUPLICADO
    // =========================

    if (error) {

      // PostgreSQL UNIQUE violation
      if (error.code === '23505') {

        return res.status(409).json({
          error: 'Ese turno ya fue reservado por otra persona'
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

    if (transporter) {

      try {

        await transporter.sendMail({

          from:
            process.env.EMAIL_USER ||
            'josuebogado321@gmail.com',

          to: emailUser,

          subject:
            '✓ Tu reserva en Centro de Estudiantes de Química',

          html: `

            <h2>Reserva Confirmada</h2>

            <p>
              Hola <strong>${nombre_solicitante}</strong>,
            </p>

            <p>
              Tu reserva fue registrada exitosamente.
            </p>

            <hr>

            <table style="border-collapse: collapse;">

              <tr>
                <td style="padding: 8px;">
                  <strong>Espacio:</strong>
                </td>

                <td style="padding: 8px;">
                  ${espacios_map[espacio_id]}
                </td>
              </tr>

              <tr>
                <td style="padding: 8px;">
                  <strong>Fecha:</strong>
                </td>

                <td style="padding: 8px;">
                  ${new Date(fecha).toLocaleDateString('es-PY')}
                </td>
              </tr>

              <tr>
                <td style="padding: 8px;">
                  <strong>Turno:</strong>
                </td>

                <td style="padding: 8px;">
                  ${turno.toUpperCase()}
                </td>
              </tr>

              <tr>
                <td style="padding: 8px;">
                  <strong>Horario:</strong>
                </td>

                <td style="padding: 8px;">
                  ${hora_inicio} - ${hora_fin}
                </td>
              </tr>

              <tr>
                <td style="padding: 8px;">
                  <strong>Motivo:</strong>
                </td>

                <td style="padding: 8px;">
                  ${motivo || 'Sin especificar'}
                </td>
              </tr>

              <tr style="background: #f0f0f0;">

                <td style="padding: 8px;">
                  <strong>Código de Cancelación:</strong>
                </td>

                <td style="
                  padding: 8px;
                  font-weight: bold;
                  color: #d86060;
                ">
                  ${codigo}
                </td>

              </tr>

            </table>

            <hr>

            <p>
              <small>
                Guarda este código si deseas cancelar tu reserva.
              </small>
            </p>

          `

        });

      } catch (emailError) {

        console.error(
          'Error al enviar email:',
          emailError
        );

      }

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