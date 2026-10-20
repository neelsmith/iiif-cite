`imageviewer` web app

## Overview

A webapp for browsing images served from an International Image Interoperatibility Framework (IIIF) source. The app takes a URL for an IIIF manifest, lets the user browse thumbnail images and select an image that can then be panned or zoomed. 



## Functionality

The webapp should be entirely selfcontained so it can be run from a single html file either by opening from the local file server or by serving on a web server.



## Architecture & Directory Structure

- `quarto`, `docs`, `README.md` and `releases.md` are all user-readable content owned by me; Claude should not touch them
- `notes` is for documentation and notes that Claude writes, includes session summaries so I can reliably pick up working with Claude from different machines
- `src` is for source code



## Testing Guidelines

- Write unit tests for utility functions and integration/component tests for critical UI flows.
- Run relevant tests before proposing significant refactors.