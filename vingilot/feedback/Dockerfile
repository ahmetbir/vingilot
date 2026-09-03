FROM golang:1.22-alpine AS build
WORKDIR /src
COPY go.mod ./
COPY *.go ./
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /feedback .

FROM scratch
COPY --from=build /feedback /feedback
USER 65534:65534
ENTRYPOINT ["/feedback"]
