I found this while implementing https://github.com/pypa/packaging/issues/940

Here is an example:

```python
>>> list(SpecifierSet(">=1,!=1.*,!=2.*,!=3.0,<=3.0").filter(["0.9", "3.0.dev0", "3.0a1", "4.0"]))
[]
```

However this is wrong as `3.0.dev0` is a valid version of this `SpecifierSet`, this can be seen when passing only that version:

```python
>>> list(SpecifierSet(">=1,!=1.*,!=2.*,!=3.0,<=3.0").filter(["3.0.dev0"]))
['3.0.dev0']
```
