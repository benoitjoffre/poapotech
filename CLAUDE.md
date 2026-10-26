# Development instructions

## Efficiency

- Be concise.
- Avoid unnecessary explanations.
- Search relevant symbols before reading files.
- Never scan the entire repository without reason.
- Avoid reading generated files and dependencies.
- Reuse existing code.
- Do not spawn subagents unless necessary.

## Workflow

- For small tasks, implement directly.
- For complex tasks, propose a short plan first.
- Modify only necessary files.
- Run targeted tests.
- Avoid repeated full builds.

## Architecture

- Respect existing patterns.
- Do not introduce unnecessary abstractions.
- Keep business logic separate from controllers.

## Safety

- Do not modify production data.
- Do not commit without permission.
- Do not silently skip essential validation.

## Output

- Summarize changes in 5 lines maximum.
- Mention only relevant risks and failures.
