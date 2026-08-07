// One-off helper: prints a bcrypt hash for ADMIN_USERS, so a plain password never has to be
// typed anywhere but here. Usage:
//   node hash-password.js "the password"
const bcrypt = require("bcryptjs");

const password = process.argv[2];
if (!password) {
  console.error('Usage: node hash-password.js "the password"');
  process.exit(1);
}
console.log(bcrypt.hashSync(password, 10));
