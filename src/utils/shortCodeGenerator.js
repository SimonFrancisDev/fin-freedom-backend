const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

export const generateShortCode = () => {
  let code = 'FFN-';
  for (let i = 0; i < 6; i++) {
    code += characters.charAt(Math.floor(Math.random() * characters.length));
  }
  return code;
};