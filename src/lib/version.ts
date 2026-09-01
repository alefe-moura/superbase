/**
 * Versão do sistema, no formato X.Y.Z.
 *
 * A fonte única é o campo `version` do package.json. O next.config.ts publica
 * esse valor como NEXT_PUBLIC_APP_VERSION, e é daqui que a interface lê.
 * Nunca escreva o número solto num componente.
 *
 * Quando subir cada número:
 *   X  alteração grande, principalmente de design
 *   Y  funcionalidade ou módulo novo
 *   Z  correção do que já existe
 */
export const APP_VERSION = process.env.NEXT_PUBLIC_APP_VERSION ?? '0.0.0'
