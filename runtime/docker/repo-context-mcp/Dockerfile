FROM python:3.13-alpine

WORKDIR /app

RUN addgroup -S app && adduser -S -G app app

COPY src /app/src

RUN mkdir -p /data/qmd /data/dropbox

ENV PYTHONPATH=/app

EXPOSE 8811

USER app

CMD ["python", "-m", "src.backend.mcp.repo_context_mcp"]
