#!/usr/bin/env python3
"""Rotate the member logins.

The placeholder passwords are in this repository's history, which is public, so
they are public knowledge. Hashing them would change nothing — anyone can read
the plaintext in an old commit — and the only fix is to replace them.

Run this on your own machine:

    python3 deploy/rotate-logins.py

It prints two things: the new passwords, once, for you to save in a password
manager; and a JSON table holding only their scrypt hashes, to paste into the
GitHub repo secret MEMBER_ACCOUNTS_JSON (Settings → Secrets and variables →
Actions). The next deploy writes that table to the VM and restarts the service,
and the published passwords stop working.

Nothing here is written to disk, and the JSON it prints contains no password —
a scrypt hash cannot be turned back into one.

Options:
    --names a,b,c   which accounts to create (default: the current three)
    --ask           choose the passwords yourself instead of generating them
    --plan pro      the plan for every account (default: pro)
"""
import argparse
import json
import os
import secrets
import string
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import members  # noqa: E402  (after the path fix-up)

# Unambiguous by design: no l/1/I or O/0, because these get read off a screen
# and typed into a phone. 20 characters from this alphabet is ~112 bits.
ALPHABET = ("".join(c for c in string.ascii_letters + string.digits
                    if c not in "lIO01")
            + "-._~")
LENGTH = 20


def generate() -> str:
    return "".join(secrets.choice(ALPHABET) for _ in range(LENGTH))


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--names", default="taureye,sreeraman,sri",
                    help="comma-separated account names")
    ap.add_argument("--ask", action="store_true",
                    help="type the passwords yourself instead of generating them")
    ap.add_argument("--plan", default="pro", help="plan for every account")
    args = ap.parse_args()

    names = [n.strip().lower() for n in args.names.split(",") if n.strip()]
    if not names:
        print("no account names given", file=sys.stderr)
        return 2

    table, plain = {}, {}
    for name in names:
        if args.ask:
            import getpass
            pw = getpass.getpass(f"password for {name}: ")
            if pw != getpass.getpass("repeat:            "):
                print("they do not match", file=sys.stderr)
                return 1
            if len(pw) < members.PASSWORD_MIN:
                print(f"at least {members.PASSWORD_MIN} characters, please",
                      file=sys.stderr)
                return 1
        else:
            pw = generate()
        plain[name] = pw
        table[name] = {"password": members.hash_password(pw), "plan": args.plan,
                       "name": name.capitalize(), "owner": True}

    if not args.ask:
        print("\n=== NEW PASSWORDS — shown once, save them now ===\n")
        width = max(len(n) for n in names)
        for name in names:
            print(f"  {name.ljust(width)}   {plain[name]}")
        print("\nThese are not stored anywhere. Close this window and they are gone.\n")

    print("=== Paste this into the GitHub repo secret MEMBER_ACCOUNTS_JSON ===")
    print("    (Settings → Secrets and variables → Actions → New repository secret)\n")
    print(json.dumps(table, separators=(",", ":")))
    print("\nThen run the Deploy workflow. The next boot uses these and the old"
          "\npasswords stop working. Verify by signing in with a new one.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
