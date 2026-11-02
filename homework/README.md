# homework/

Put your course homework here, with one folder per **course week**:

```
homework/
  week4/
    hw1.ipynb          # whatever the course gives you: notebooks, PDFs, notes
    assignment.pdf
    STATUS.md          # written by the agents, don't edit by hand
```

Then, in Claude Code:
- `/homework-plan 4` reads the folder, breaks each homework into 30–90 minute steps, writes `STATUS.md` and puts the steps on your board.
- `/homework-sync 4` checks your saved notebooks and ticks off the steps that are done.

The agents only plan and track. They never write solutions, and they only edit `STATUS.md`. See "Homework workflow" in `CLAUDE.md` for the details.

Everything in this folder except this README is git-ignored, so your work and your course's material stay on your machine.
