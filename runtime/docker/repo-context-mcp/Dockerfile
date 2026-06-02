ARG TASKSAIL_PYTHON_BASE_IMAGE=python:3.12-alpine
FROM ${TASKSAIL_PYTHON_BASE_IMAGE}

WORKDIR /app

RUN addgroup -S app && adduser -S -G app app

COPY src /app/src

RUN mkdir -p /data/qmd /data/dropbox

ENV PYTHONPATH=/app

EXPOSE 8811

USER app

CMD ["python", "-m", "src.backend.mcp.repo_context_mcp"]
