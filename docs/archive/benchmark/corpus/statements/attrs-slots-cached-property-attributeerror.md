# AttributeError propagation is broken in cached_property with slots=True 

(python-attrs/attrs issue #1230, verbatim body)

Let's start with a regular class:
```python
class A:

    @cached_property
    def x(self):
        return self.y

    @property
    def y(self):
        raise AttributeError("Message")
        
a = A()
print(a.x)  # AttributeError: Message
```
Just as expected. Now let's use attrs with `__dict__`:
```python
@define(slots=False)
class A:
    ...

print(a.x)  # AttributeError: Message
```
So far so good. But:
```python
@define  # slots=True by default
class A:
    ...

print(a.x)  # AttributeError: 'A' object has no attribute 'y'
```

This made me spend quite some time wondering where did my attribute go :)
