Towards https://github.com/pypa/packaging/issues/943

I am reviewing arbitrary equality edge cases, here's an edge case that violates intersection preservation :

```python
>>> list(SpecifierSet("===1.0").filter(["1.0", "1.0.0"]))
['1.0']
>>> list(SpecifierSet("===1.0.0").filter(["1.0", "1.0.0"]))
['1.0.0']
>>> list(SpecifierSet("===1.0,===1.0.0").filter(["1.0", "1.0.0"]))
['1.0']
```

The last expression is fixed by this PR:

```python
>>> list(SpecifierSet("===1.0,===1.0.0").filter(["1.0", "1.0.0"]))
[]
```
