# `get_parameter_source()` returns `None` in 8.4.0


---

Starting with 8.4, get_parameter_source() returns None.

Repro:

```python
import click

class Source(click.ParamType):
    name = "source"
    def convert(self, value, param, ctx):
        return {'value': value, 'source': ctx.get_parameter_source(param.name)}

@click.command
@click.option('--default', type=Source(), default='/tmp/file')
@click.option('--nodefault', type=Source())
def main(default, nodefault):
    print("default:", default)
    print("nodefault:", nodefault)

if __name__ == '__main__':
    main()
```

Output:

```console
$ pip install click==8.4.0 -q
$ python source.py                  
default: {'value': '/tmp/file', 'source': None}
nodefault: None
$ python source.py --default cli --nodefault cli
default: {'value': 'cli', 'source': None}
nodefault: {'value': 'cli', 'source': None}

$ pip install click==8.3.3 -q                   
$ python source.py                              
default: {'value': '/tmp/file', 'source': <ParameterSource.DEFAULT: 5>}
nodefault: None
$ python source.py --default cli --nodefault cli
default: {'value': 'cli', 'source': <ParameterSource.COMMANDLINE: 2>}
nodefault: {'value': 'cli', 'source': <ParameterSource.COMMANDLINE: 2>}
```

Environment:

- Python version: 3.14.4 (seems to happen on all versions, on both macOS and Linux)
- Click version: 8.4.0

