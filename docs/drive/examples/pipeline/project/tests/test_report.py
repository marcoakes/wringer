from pipeline.report import render
from pipeline.runner import FAILED, OK, Result


def test_an_ok_run_says_so_and_counts_the_jobs():
    text = render([Result("build", OK), Result("test", OK)])
    assert "Run succeeded: 2 jobs" in text
    assert "ok       build" in text


def test_a_failure_is_named_with_its_detail():
    text = render([Result("build", FAILED, "compiler exploded")])
    assert "FAILED   build  compiler exploded" in text
    assert "Run did not succeed: 1 failed (build)" in text


def test_every_job_gets_a_line():
    results = [Result("a", OK), Result("b", OK), Result("c", FAILED, "no")]
    assert len(render(results).splitlines()) == 5
