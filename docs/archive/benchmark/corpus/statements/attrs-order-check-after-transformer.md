# field checks done too early causing error

(python-attrs/attrs issue #1147, verbatim body)

Attrs does some checks on fields like no defaulted fields coming before non-defaulted fields before running custom field transformers. This is a problem when a field transformer intends to modify the fields but gets an error before being able to apply their modification.
For example, this field transformer reorders fields so that in fact the defaulted field `x` comes after the non-defaulted field `y`. But attrs errors before the transformer is ever called.

```python
def order_by_metadata(cls, fields):
    fields.sort(key=lambda x: x.metadata["field_order"])
    return fields

@define(field_transformer=order_by_metadata)
class A:
    x: int = field(metadata={"field_order": 1}, default=0)
    y: int = field(metadata={"field_order": 0})
```

```
Traceback (most recent call last):
  File "...", line 426, in <module>
    class A:
  File ".../attr/_next_gen.py", line 146, in wrap
    return do_it(cls, True)
  File ".../attr/_next_gen.py", line 90, in do_it
    return attrs(
  File ".../attr/_make.py", line 1603, in attrs
    return wrap(maybe_cls)
  File ".../attr/_make.py", line 1499, in wrap
    builder = _ClassBuilder(
  File ".../attr/_make.py", line 657, in __init__
    attrs, base_attrs, base_map = _transform_attrs(
  File ".../attr/_make.py", line 566, in _transform_attrs
    raise ValueError(
ValueError: No mandatory attributes allowed after an attribute with a default value or factory.  Attribute in question: Attribute(name='y', default=NOTHING, validator=None, repr=True, eq=True, eq_key=None, order=True, order_key=None, hash=None, init=True, metadata=mappingproxy({'field_order': 0}), type='int', converter=None, kw_only=False, inherited=False, on_setattr=None, alias=None)
```
I think these checks should be done after custom field transformers.
