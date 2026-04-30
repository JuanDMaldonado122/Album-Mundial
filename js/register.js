import { persistAuthSession, registerUser } from "./services/authService.js";

    persistAuthSession().catch(e => console.error(e));

    window.doRegister = async () => {
        const email = document.getElementById('reg-email').value.trim();
        const pass  = document.getElementById('reg-pass').value;
        const pass2 = document.getElementById('reg-pass2').value;
        const btn   = document.getElementById('btn-register');
        const msg   = document.getElementById('status-msg');

        msg.className = '';
        msg.innerHTML = '';

        if (!email || !pass) {
            msg.className = 'error';
            msg.textContent = '❌ Completa todos los campos.';
            return;
        }
        if (pass.length < 6) {
            msg.className = 'error';
            msg.textContent = '❌ La contraseña debe tener al menos 6 caracteres.';
            return;
        }
        if (pass !== pass2) {
            msg.className = 'error';
            msg.textContent = '❌ Las contraseñas no coinciden.';
            return;
        }

        btn.disabled = true;
        btn.innerHTML = '<span class="spinner"></span>Creando cuenta...';

        try {
            await registerUser(email, pass);
            msg.className = 'success';
            msg.textContent = '✅ ¡Cuenta creada! Redirigiendo al álbum...';
            setTimeout(() => { window.location.href = 'index.html'; }, 1500);
        } catch (err) {
            btn.disabled = false;
            btn.innerHTML = 'Crear Mi Cuenta';
            msg.className = 'error';
            if (err.code === 'auth/email-already-in-use') {
                msg.textContent = 'Este correo ya tiene cuenta. Entra desde la pantalla principal.';
            } else if (err.code === 'auth/admin-restricted-operation') {
                msg.textContent = 'Activa Email/Contrasena en Firebase Authentication.';
            } else {
                msg.textContent = 'Error: ' + err.message;
            }
        }
    };
