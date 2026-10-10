import { existsSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
if (!existsSync(".env.local")) {
  writeFileSync(
    ".env.local",
    `BETTER_AUTH_URL=http://localhost:3000\nBETTER_AUTH_SECRET=${randomBytes(48).toString("base64url")}\nDATABASE_PATH=./data/sakhi.sqlite\nNOTIFICATION_PROVIDER=simulation\nJOB_SECRET=${randomBytes(48).toString("base64url")}\nEMERGENCY_NUMBER=112\n`,
    { mode: 0o600, flag: "wx" },
  );
  console.log(
    "Created local configuration with random secrets. No messages will be sent.",
  );
} else console.log("Kept existing .env.local unchanged.");
