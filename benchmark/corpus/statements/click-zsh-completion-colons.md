# zsh completion still misbehaving in the presence of `:`

Source: pallets/click issue #2703 (https://github.com/pallets/click/issues/2703) — body reproduced VERBATIM below.

---

<!--
This issue tracker is a tool to address bugs in Click itself. Please use
Pallets Discord or Stack Overflow for questions about your own code.

Replace this comment with a clear outline of what the bug is.
-->

<!--
Describe how to replicate the bug.

Include a minimal reproducible example that demonstrates the bug.
Include the full traceback if there was an exception.
-->

Given `foo` containing:

```python
#!/usr/bin/env python3
from click.shell_completion import CompletionItem
import click

class Foo(click.ParamType):
    def convert(self, value, param, ctx):
        return value

    def shell_complete(self, ctx, param, incomplete):
        return [
            CompletionItem(value=value, help="adsf") for value in 
            ["baz:quux", "spam:eggs"]
        ]

@click.command()
@click.argument("foo", type=Foo())
def main(foo):
    print(foo)
```

and running shell completion generation, followed by attempting to complete the command (indicated via `<Tab>`, produces:

```
⊙  PATH=$PWD:/Users/Julian/.local/share/virtualenvs/bowtie/bin/:$PATH
⊙  eval "$(_FOO_COMPLETE=zsh_source ./foo)"                                                                                                                                                                                                                                                                         
⊙  foo <Tab>
baz   -- quux:adsf
spam  -- eggs:adsf
```

rather than the expected:

```
baz:quux   -- adsf
spam:eggs -- adsf
```

<!--
Describe the expected behavior that should have happened but didn't.
-->

This seems to be a regression on #1812.

The fix mentioned there (of "fake escaping" the colons via `.replace(":", "\\:")` seems to work.

Environment:

- Python version:

```
⊙  python --version                                                                                                                                                                                                                                                                                                 julian@Airm
Python 3.11.9
```

- Click version:

```
⊙  python -m pip show click                                                                                                                                                                                                                                                                                         julian@Airm
Name: click
Version: 8.1.7
Summary: Composable command line interface toolkit
Home-page: https://palletsprojects.com/p/click/
Author: 
Author-email: 
License: BSD-3-Clause
Location: /Users/julian/.dotfiles/.local/share/virtualenvs/bowtie/lib/python3.11/site-packages
Requires: 
Required-by: rich-click, trogon, virtue
```
