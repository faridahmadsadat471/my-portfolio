import { createConnection } from 'node:net';
import { createTransport } from 'nodemailer';

export function createSmtpMailer(options) {
  return createTransport({
    ...options,
    // Use the operating system resolver, including VPN/Windows DNS settings.
    // Nodemailer still performs TLS and certificate verification for the hostname.
    getSocket(connectionOptions, callback) {
      const socket = createConnection({ host: connectionOptions.host, port: connectionOptions.port });
      const timeout = setTimeout(() => {
        const error = new Error('SMTP connection timed out.');
        error.code = 'ETIMEDOUT';
        socket.destroy(error);
      }, connectionOptions.connectionTimeout || 10000);
      const onError = error => {
        clearTimeout(timeout);
        socket.removeListener('connect', onConnect);
        callback(error);
      };
      const onConnect = () => {
        clearTimeout(timeout);
        socket.removeListener('error', onError);
        callback(null, { connection: socket });
      };
      socket.once('error', onError);
      socket.once('connect', onConnect);
    }
  });
}
