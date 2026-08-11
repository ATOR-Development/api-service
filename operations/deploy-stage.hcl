variable "commit_sha" {
  type        = string
  description = "The git commit SHA to use for the runtime image tag"
}

job "api-service-stage" {
  datacenters = ["ator-fin"]
  type = "service"
  namespace = "stage-services"
  
  constraint {
    attribute = "${meta.pool}"
    value = "stage"
  }

  group "api-service-stage-group" {
    count = 1

    update {
      max_parallel     = 1
      canary           = 1
      min_healthy_time = "30s"
      healthy_deadline = "5m"
      auto_revert      = true
      auto_promote     = true
    }

    network {
      mode = "bridge"
      port "http-port" {
        host_network = "wireguard"
      }
    }

    volume "api-service-stage" {
      type      = "host"
      read_only = false
      source    = "api-service-stage"
    }

    service {
      name = "api-service-stage"
      port = "http-port"
      tags = [
        "logging",
        "traefik-ec.enable=true",
        "traefik-ec.http.routers.api-stage.rule=Host(`api-stage.ec.anyone.tech`)",
        "traefik-ec.http.routers.api-stage.entrypoints=https",
        "traefik-ec.http.routers.api-stage.tls=true",
        "traefik-ec.http.routers.api-stage.tls.certresolver=anyoneresolver",
        "traefik-ec.http.routers.api-stage.middlewares=api-stage-ratelimit",
        "traefik-ec.http.middlewares.api-stage-ratelimit.ratelimit.average=1000",
        "traefik-ec.http.middlewares.api-stage-ratelimit.ratelimit.burst=10"
      ]
      check {
        name = "Api service check"
        type = "tcp"
        port = "http-port"
        path = "/"
        interval = "10s"
        timeout = "10s"
        address_mode = "alloc"
        check_restart {
          limit = 10
          grace = "30s"
        }
      }
    }

    task "api-service-stage-task" {
      driver = "docker"

      config {
        image = "ghcr.io/anyone-protocol/api-service:${var.commit_sha}"
        force_pull = true
        command = "node"
        args = [
          "--max-http-header-size", "80000",
          "dist/src/app.js"
        ]
      }

      volume_mount {
        volume      = "api-service-stage"
        destination = "/api-service-stage"
        read_only   = false
      }

      env {
        VERSION = var.commit_sha
        ONIONOO_PROTOCOL="http://"
        CLUSTER="local"
        ENV="main"
        JOB="consulagentonionoo"
        HEXAGON_RESOLUTION="4"
        GEODATADIR="/api-service-stage/geo-ip-db/data"
        GEOTMPDIR="/api-service-stage/tmp"
        CU_URL="https://cu-stage.anyone.tech"
        DB_NAME="uns_indexer"
      }

      template {
        data = <<-EOH
        OPERATOR_REGISTRY_PROCESS_ID="{{ key "smart-contracts/stage/operator-registry-address" }}"

	      {{- range service "victoriametrics-db" }}
  	    VICTORIA_METRICS_ADDRESS="http://{{ .Address }}:{{ .Port }}"
	      {{- end }}
  
        {{- range service "onionoo-war-live" }}
        ONIONOO_INSTANCE="{{ .Address }}:{{ .Port }}"
        {{- end }}

        {{- range service "validator-stage-mongo" }}
        MONGO_URI="mongodb://{{ .Address }}:{{ .Port }}/api-service-stage"
        {{- end }}

        {{- range service "uns-record-indexer-postgres-stage" }}
        DB_HOST="{{ .Address }}"
        DB_PORT="{{ .Port }}"
        {{- end }}
        EOH
        destination = "local/config.env"
        env = true
      }

      consul {}

      vault { role = "any1-nomad-workloads-controller" }

      template {
        data = <<-EOH
        {{ with secret "kv/stage-services/api-service-stage" }}
        DB_USER="{{ .Data.data.DB_USER }}"
        DB_PASS="{{ .Data.data.DB_PASS }}"
        {{ end }}
        EOH
        destination = "secrets/keys.env"
        env         = true
      }

      service {
        name = "api-service-stage"
        tags = [ "logging" ]
      }

      resources {
        cpu = 256
        memory = 1024
      }
    }

    task "varnish-cache-stage-task" {
      driver = "docker"

      template {
        data = <<-EOH
        VARNISH_HTTP_PORT="{{ env `NOMAD_PORT_http_port` }}"
        EOH
        destination = "local/file.env"
        env = true
      }

      config {
        image = "varnish"
        force_pull = true
        volumes = [
          "local/default.vcl:/etc/varnish/default.vcl:ro"
        ]
        ports = ["http-port"]
      }

      resources {
        cpu = 256
        memory = 256
      }

      template {
        change_mode = "noop"
        data        = <<-EOH
        vcl 4.0;

        backend default {
            .host = "127.0.0.1";
            .port = "3000";
        }

        sub vcl_backend_response {
            set beresp.ttl = 5m;
        }
        EOH
        destination = "local/default.vcl"
      }
    }
  }
}
