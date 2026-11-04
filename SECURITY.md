# Security Policy

## Supported versions

The project is a self-contained front-end application with no backend, no
network calls and no authentication. The latest released version is the only
supported one.

| Version | Supported |
|---------|-----------|
| latest  | ✅        |

## Reporting a vulnerability

If you find a security issue, please **do not open a public issue**. Use the
repository's private vulnerability reporting (GitHub *Security* → *Report a
vulnerability*) or contact the maintainer directly.

Please include:

- a description of the issue and its impact
- the affected file or version
- steps to reproduce, if possible

You can expect an acknowledgement within a few days.

## Scope notes

This project runs entirely in the browser and ships no server component, so
the realistic threat surface is small. Things that are **out of scope**:

- Vulnerabilities in the upstream [three.js](https://threejs.org) library —
  please report those to the three.js maintainers.
- Findings that require a user to deliberately inject hostile input into the
  browser console.

## Data handling

The simulation is entirely synthetic: the catalogue, orders, suppliers,
customers and staff are generated procedurally from a seed. No personal data
is collected, stored or transmitted. The only thing persisted in the browser is
the selected interface language (`localStorage` key `nexus-wms-lang`).
