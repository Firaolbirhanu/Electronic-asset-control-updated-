'use strict';

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');

const dbPath = path.join(__dirname, '..', 'assets.db');

function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(question, (answer) => {
    rl.close();
    resolve(answer.trim());
  }));
}

function askHidden(question) {
  const input = process.stdin;
  return new Promise((resolve, reject) => {
    let answer = '';
    const cleanup = () => {
      input.setRawMode(false);
      input.pause();
      input.removeListener('keypress', onKeypress);
      process.stdout.write('\n');
    };
    const onKeypress = (text, key) => {
      if (key.ctrl && key.name === 'c') {
        cleanup();
        reject(new Error('Canceled.'));
      } else if (key.name === 'return' || key.name === 'enter') {
        cleanup();
        resolve(answer);
      } else if (key.name === 'backspace') {
        answer = [...answer].slice(0, -1).join('');
      } else if (text && !key.ctrl && !key.meta) {
        answer += text;
      }
    };

    process.stdout.write(question);
    readline.emitKeypressEvents(input);
    input.setRawMode(true);
    input.resume();
    input.on('keypress', onKeypress);
  });
}

async function main() {
  if (!process.stdin.isTTY || typeof process.stdin.setRawMode !== 'function') {
    throw new Error('Run this command from an interactive terminal so the password can be hidden.');
  }
  if (!fs.existsSync(dbPath)) {
    throw new Error(`Database not found at ${dbPath}. No changes were made.`);
  }

  const db = new Database(dbPath);
  try {
    const admins = db.prepare("SELECT id, username FROM users WHERE role = 'admin' ORDER BY username").all();
    if (!admins.length) throw new Error('No administrator account exists in this database.');

    console.log('Administrator accounts:');
    admins.forEach((admin, index) => console.log(`${index + 1}. ${admin.username}`));
    const selection = await ask('Choose the account number to reset: ');
    const index = Number(selection) - 1;
    if (!Number.isInteger(index) || index < 0 || index >= admins.length) {
      throw new Error('Invalid account selection. No changes were made.');
    }

    const password = await askHidden('New password (minimum 12 characters; input hidden): ');
    if (password.length < 12) throw new Error('Password must be at least 12 characters. No changes were made.');
    const confirmation = await askHidden('Re-enter new password (input hidden): ');
    if (password !== confirmation) throw new Error('Passwords do not match. No changes were made.');

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupPath = `${dbPath}.${timestamp}.bak`;
    await db.backup(backupPath);

    const hash = bcrypt.hashSync(password, 12);
    const result = db.prepare('UPDATE users SET password_hash = ? WHERE id = ? AND role = ?')
      .run(hash, admins[index].id, 'admin');
    if (result.changes !== 1) throw new Error('Administrator account changed unexpectedly. Restore from the backup if needed.');

    console.log(`Password reset for "${admins[index].username}".`);
    console.log(`Database backup: ${backupPath}`);
  } finally {
    db.close();
  }
}

main().catch((error) => {
  console.error(`Password reset failed: ${error.message}`);
  process.exitCode = 1;
});
