// Avoid visually confusing characters: 0/O, 1/I
const CHARSET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 5;

export function generateRoomCode(existingCodes = new Set()) {
  let code;
  let attempts = 0;

  do {
    code = '';
    for (let i = 0; i < CODE_LENGTH; i++) {
      code += CHARSET[Math.floor(Math.random() * CHARSET.length)];
    }
    attempts++;
  } while (existingCodes.has(code) && attempts < 20);

  return code;
}
