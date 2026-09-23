# jev クイックスタート

> APIキーは事前に発行しておくこと

```bash
export TYPESAFE_API_KEY=<YOUR_API_KEY>
```

```bash
curl -X POST https://api.typesafe.ai/v1/systemone \
  -H "Authorization: Bearer $TYPESAFE_API_KEY" \
  -H "Content-Type: application/json" \
  -d @- <<'EOF'
  {
    "state": "Hi, I've been trying to connect my Stripe account for 3 days and the integration keeps failing. I'm losing sales. Please help ASAP.",
    "model": "jev-latest",
    "questions": {
      "urgency": {
        "type": "noul",
        "instructions": "Does this message express urgency?"
      }
    }
  }
EOF
```

```json
{
    "model":"jev-1.13.0",
    "answers":{
        "urgency":{
            "type":"noul",
            "noul":0.98
        }
    },
    "usage":{
        "input_tokens":302,
        "output_tokens":21
    }
}
```