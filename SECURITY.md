# Security policy

## Reporting a vulnerability

Please do not open a public issue for a security problem.

Use GitHub's private reporting instead: open the **Security** tab of this repository and choose **Report a vulnerability**. Include what you found, the steps to reproduce it and, if you can, what an attacker could do with it.

This is a one-person project, so replies are best effort. You will get an answer in the same private thread, and a fix is published before the details are.

## What is in scope

- The API, the engine and the SQL migrations in this repository.
- The Docker image and the Docker Compose setup.
- The CI configuration in `.github/`.

## What is not

- Problems in Node.js, PostgreSQL, Fastify, Docker or GitHub themselves. Report those to their owners.
- A deployment someone else runs with weak passwords or open ports. The Compose file only opens ports on `127.0.0.1` and its passwords are placeholders for local use.
