import pytest

from pipeline.graph import Graph, GraphError

SIMPLE = {
    "build": {"command": "true"},
    "test": {"needs": ["build"], "command": "true"},
    "docs": {"command": "true"},
}


def test_order_puts_every_job_after_what_it_needs():
    order = Graph.from_data(SIMPLE).order()
    assert order.index("build") < order.index("test")


def test_order_is_reproducible():
    graph = Graph.from_data(SIMPLE)
    assert graph.order() == graph.order()


def test_a_cycle_is_refused_by_name():
    data = {
        "a": {"needs": ["b"], "command": "true"},
        "b": {"needs": ["a"], "command": "true"},
    }
    with pytest.raises(GraphError) as caught:
        Graph.from_data(data).order()
    assert "cycle" in str(caught.value)
    assert "a, b" in str(caught.value)


def test_a_need_that_is_not_declared_is_refused():
    with pytest.raises(GraphError) as caught:
        Graph.from_data({"a": {"needs": ["ghost"], "command": "true"}})
    assert "ghost" in str(caught.value)


def test_dependents_names_the_jobs_that_wait_on_this_one():
    graph = Graph.from_data(SIMPLE)
    assert graph.dependents("build") == ("test",)
    assert graph.dependents("docs") == ()


def test_unknown_keys_are_refused():
    with pytest.raises(GraphError) as caught:
        Graph.from_data({"a": {"commnd": "true"}})
    assert "commnd" in str(caught.value)
