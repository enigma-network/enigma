FROM golang:1.23-alpine AS builder
WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-s -w" -o enigma-node ./cmd/node

FROM alpine:3.19
RUN apk add --no-cache ca-certificates
COPY --from=builder /app/enigma-node /usr/local/bin/enigma-node
ENTRYPOINT ["enigma-node"]
