# pyparsing issue #492: `QuotedString`, `multiline=True` and a newline in the quote sequence

(verbatim body of https://github.com/pyparsing/pyparsing/issues/492)

I think I've found a bug in `QuotedString` where `multiline=True` and there is a newline in the quote sequence.

The newline is ignored.

```python
ParserElement.set_default_whitespace_chars("")
newlinequote = QuotedString("\n;", multiline=True)
newlinequote.search_string("lsjdf \n;Hi \n mum!\n; sldjf")  # Receive [['Hi \nmum!\n']]. Expect [['Hi \n mum!']]
newlinequote.search_string("lsjdf \n;Hi \n m;um!\n; sldjf")  # Receive [['Hi \n m']]. Expect [['Hi \n m;um!']]
newlinequote.search_string("lsj;df \n;Hi \n m;um!\n; sldjf")  # Receive [['df \n'], ['um!\n']]. Expect [['Hi \n m;um!']]
```

Is this the desired behaviour?
