
import anthropic

client = anthropic.Anthropic()

message = client.messages.create(
    model="claude-haiku-4-5",
    max_tokens=1000,
    messages=[
        {
            "role": "user",
            "content": "What is the Tchekov's gun principle? Please explain it in a haiku.",
        }
    ],
)
print(message.content)