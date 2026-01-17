.PHONY: sb-status sb-start sb-stop sb-pull sb-reset sb-push audit

sb-status:
	supabase status

sb-start:
	supabase start

sb-stop:
	supabase stop

sb-pull:
	supabase db pull

sb-reset:
	supabase db reset

sb-push:
	supabase db push

audit:
	bash scripts/audit.sh
