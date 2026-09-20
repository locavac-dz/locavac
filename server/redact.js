// Masque les secrets transportés en query string avant toute écriture dans un journal :
// jetons de vérification d'e-mail et de réinitialisation, code et state OAuth, JWT.
const SENSITIVE_PARAMS = /([?&](?:token|reset_token|access_token|id_token|code|state)=)[^&#\s]*/gi;

function redactUrl(url) {
  return String(url ?? '').replace(SENSITIVE_PARAMS, '$1***');
}

module.exports = { redactUrl };
