# Contributing

Thanks for helping out.

## Set up

```sh
bun install
bun playwright install chromium
bun run build
```

`bun run build` writes `dist/browsershot`, which is not committed.

## Run the tests

```sh
bun test
```

The unit tests do not open a browser and do not use the network.

## Code style

- No code comments. Names carry the intent.
- One return at the end. Build the value in a variable and assign it inside the `if` blocks.
- One line per declaration, assignment, argument and call.
- `if` statements over ternaries.
- Explicit braces and explicit parentheses always.
- Match the style already in the file you touch.

## Propose a change

1. Open an issue first for anything larger than a small fix.
2. Branch off `main`.
3. Add a test for the behaviour you change or fix.
4. Run `bun test` and `bun run build`.
5. Open a pull request and fill in the template.

Keep the diff small. Every changed line should trace back to the stated problem.
