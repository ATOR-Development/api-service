job "metrics-service-stage" {
  datacenters = ["ator-fin"]
  type        = "service"
  namespace   = "ator-network"

  group "metrics-service-stage-group" {
    count = 1

    network {
      mode = "bridge"
      port "http-port" {
        static       = 9133
        to           = 3000
        #host_network = "wireguard"
      }
    }

    task "metrics-service-stage-task" {
      driver = "docker"

      template {
        data        = <<EOH
	{{- range nomadService "victoriametrics-db" }}
  	    VICTORIA_METRICS_ADDRESS="http://{{ .Address }}:{{ .Port }}"
	{{ end -}}
    {{- range nomadService "onionoo-war-stage" }}
        INSTANCE="{{ .Address }}:{{ .Port }}"
    {{ end -}}
        CLUSTER="local"
        ENV="main"
        JOB="consulagentonionoo"
            EOH
        destination = "secrets/file.env"
        env         = true
      }

      config {
        image      = "svforte/metrics-service:latest-stage"
        force_pull = true
        ports      = ["http-port"]
      }

      resources {
        cpu    = 256
        memory = 256
      }

      service {
        name = "metrics-service-stage"
        port = "http-port"
        check {
          name     = "Metrics service check"
          type     = "tcp"
          port     = "http-port"
          path     = "/"
          interval = "10s"
          timeout  = "10s"
          check_restart {
            limit = 10
            grace = "30s"
          }
        }
      }
    }

  }
}
