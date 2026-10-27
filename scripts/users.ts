// Manage staff accounts. There's no sign-up page on purpose: only someone
// with the database credentials can create an account.
//
//   npm run users -- list
//   npm run users -- add <email> <name...>
//   npm run users -- passwd <email>      (also signs them out everywhere)
//   npm run users -- disable <email>     (blocks sign-in, ends their sessions)
//   npm run users -- enable <email>
//   npm run users -- signout <email>     (ends their sessions)
//   npm run users -- role <email> <owner|admin|staff>
//   npm run users -- reset-2fa <email>   (lost phone and recovery codes: they
//                                         set up two-step login again at their
//                                         next sign-in; also signs them out)
import { asc, eq } from "drizzle-orm";
import { db } from "../db";
import { sessions, userRecoveryCodes, users } from "../db/schema";
import { MIN_PASSWORD_LENGTH, hashPassword } from "../lib/auth/password";

// Reads a line from the terminal without echoing it.
function promptHidden(question: string) {
  return new Promise<string>((resolve, reject) => {
    const { stdin, stdout } = process;
    if (!stdin.isTTY) return reject(new Error("Run this in an interactive terminal."));
    stdout.write(question);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");
    let value = "";
    const onData = (chunk: string) => {
      for (const ch of chunk) {
        if (ch === "\r" || ch === "\n") {
          stdin.setRawMode(false);
          stdin.pause();
          stdin.off("data", onData);
          stdout.write("\n");
          return resolve(value);
        }
        if (ch === "\u0003") process.exit(130); // ctrl+c
        if (ch === "\u007f") value = value.slice(0, -1); // backspace
        else value += ch;
      }
    };
    stdin.on("data", onData);
  });
}

async function promptNewPassword() {
  const password = await promptHidden(`New password (min ${MIN_PASSWORD_LENGTH} characters): `);
  if (password.length < MIN_PASSWORD_LENGTH) throw new Error("Password is too short.");
  if ((await promptHidden("Repeat password: ")) !== password) throw new Error("Passwords don't match.");
  return hashPassword(password);
}

async function findUser(rawEmail: string | undefined) {
  if (!rawEmail) throw new Error("Give the user's email.");
  const email = rawEmail.trim().toLowerCase();
  const user = await db.query.users.findFirst({ where: eq(users.email, email) });
  if (!user) throw new Error(`No user with email ${email}.`);
  return user;
}

async function main() {
  const [command, ...args] = process.argv.slice(2);

  switch (command) {
    case "list": {
      const rows = await db
        .select({ email: users.email, name: users.name, disabled: users.isDisabled, role: users.role, twoStep: users.totpEnabledAt })
        .from(users)
        .orderBy(asc(users.email));
      for (const u of rows)
        console.log(`${u.email}\t${u.name}\t${u.role}\t2FA ${u.twoStep ? "on" : "not set up"}${u.disabled ? "\t(disabled)" : ""}`);
      if (rows.length === 0) console.log("No users yet.");
      return;
    }
    case "add": {
      const [rawEmail, ...nameParts] = args;
      const email = rawEmail?.trim().toLowerCase();
      const name = nameParts.join(" ").trim();
      if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !name)
        throw new Error("Usage: npm run users -- add <email> <name>");
      const passwordHash = await promptNewPassword();
      // the very first account is the owner; later ones start as staff
      const role = (await db.$count(users)) === 0 ? "owner" : "staff";
      await db.insert(users).values({ email, name, passwordHash, role });
      console.log(`Added ${name} <${email}> as ${role}. They'll set up two-step login at their first sign-in.`);
      return;
    }
    case "passwd": {
      const user = await findUser(args[0]);
      const passwordHash = await promptNewPassword();
      await db.update(users).set({ passwordHash }).where(eq(users.id, user.id));
      await db.delete(sessions).where(eq(sessions.userId, user.id));
      console.log(`Password changed for ${user.email}; existing sessions ended.`);
      return;
    }
    case "disable":
    case "enable": {
      const user = await findUser(args[0]);
      await db.update(users).set({ isDisabled: command === "disable" }).where(eq(users.id, user.id));
      if (command === "disable") await db.delete(sessions).where(eq(sessions.userId, user.id));
      console.log(`${command === "disable" ? "Disabled" : "Enabled"} ${user.email}.`);
      return;
    }
    case "signout": {
      const user = await findUser(args[0]);
      await db.delete(sessions).where(eq(sessions.userId, user.id));
      console.log(`Ended all sessions for ${user.email}.`);
      return;
    }
    case "role": {
      const user = await findUser(args[0]);
      const role = args[1];
      if (role !== "owner" && role !== "admin" && role !== "staff") throw new Error("Role must be owner, admin or staff.");
      await db.update(users).set({ role }).where(eq(users.id, user.id));
      console.log(`${user.email} is now ${role}.`);
      return;
    }
    case "reset-2fa": {
      const user = await findUser(args[0]);
      await db.update(users).set({ totpSecret: null, totpEnabledAt: null, totpLastStep: null }).where(eq(users.id, user.id));
      await db.delete(userRecoveryCodes).where(eq(userRecoveryCodes.userId, user.id));
      await db.delete(sessions).where(eq(sessions.userId, user.id));
      console.log(`Two-step login reset for ${user.email}; they'll set it up again at their next sign-in.`);
      return;
    }
    default:
      console.log(
        "Commands: list | add <email> <name> | passwd <email> | disable <email> | enable <email> | signout <email> | role <email> <owner|admin|staff> | reset-2fa <email>",
      );
  }
}

// Drizzle wraps database errors in "Failed query: ..." with the params, which
// would print the password hash; show the underlying cause instead.
main().catch((err) => {
  let cause: unknown = err;
  while (cause instanceof Error && cause.cause) cause = cause.cause;
  const pg = cause as { code?: string; constraint?: string };
  if (pg.code === "23505" && pg.constraint === "users_email_key")
    console.error("A user with that email already exists.");
  else console.error(cause instanceof Error ? cause.message : cause);
  process.exit(1);
});
